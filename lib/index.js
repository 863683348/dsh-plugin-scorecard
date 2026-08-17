/**
 * dsh-plugin-scorecard — Cordis plugin for DeepSeek Harness.
 * 插件体检评分卡：质量/安全审计、榜单与搜索（dsh-plugin 生态）。
 *
 * Tools registered:
 *   plugin_sync_catalog  — sync the dsh-plugin topic catalog
 *   plugin_audit         — full scorecard for one plugin
 *   plugin_top           — ranking by score / stars / recency
 *   plugin_search        — keyword search over the catalog
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { syncCatalog, auditInputs, rateHint } from "./catalog.js";
import { computeScorecard } from "./scorer.js";
import {
  formatScoreReport, formatTopList, formatSearchResults, formatSyncSummary,
} from "./format.js";

const name = "dsh-plugin-scorecard";
const inject = ["tools"];

const Config = z.object({
  /** Optional GitHub token: raises API rate limits for catalog sync. */
  githubToken: z.string().default(""),
  /** Scan repo install scripts for risky patterns. */
  securityScan: z.boolean().default(true),
  /** In-memory catalog TTL (ms). */
  cacheTtlMs: z.number().default(900000),
  /** Max repos fetched per sync. */
  maxCatalogSize: z.number().default(200),
});

function apply(ctx, config) {
  const opts = {
    token: config.githubToken || "",
    securityScan: config.securityScan,
    max: config.maxCatalogSize,
  };
  const note = () => rateHint(opts.token) ?? "";

  ctx.tools.register(defineTool({
    name: "plugin_sync_catalog",
    description: "同步 dsh-plugin 生态目录（GitHub topic 仓库列表），供后续 audit/top/search 使用。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          syncedAt: { type: "string" },
          count: { type: "number" },
          truncated: { type: "boolean" },
          note: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `已同步 ${value.count} 个插件${value.truncated ? "（截断）" : ""}。${value.note || ""}` }],
    },
    execute: async () => {
      const data = await syncCatalog({ token: opts.token, max: opts.max });
      return { syncedAt: data.syncedAt, count: data.count, truncated: data.truncated, note: note() };
    },
    presentCall: (args) => ({ card: "generic", title: "同步插件目录", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "plugin_audit",
    description: "对指定插件做质量与安全体检，返回 0-100 评分、等级（A/B/C/D）、信号明细与证据链。名称可为 owner/repo、仓库名或 npm 包名。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", required: true, description: "插件名称（owner/repo、仓库名或 npm 包名）" },
          securityScan: { type: "boolean", description: "是否扫描安装脚本（默认按插件配置）" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          grade: { type: "string" },
          blocked: { type: "boolean" },
          verdict: { type: "string" },
          report: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.report }],
    },
    execute: async (args) => {
      const scan = args.securityScan === undefined ? opts.securityScan : args.securityScan;
      const inputs = await auditInputs(args.name, { token: opts.token, securityScan: scan });
      if (!inputs) {
        return {
          name: args.name, score: 0, grade: "?", blocked: false,
          verdict: "未找到该插件，请确认名称或先 plugin_sync_catalog 同步目录。",
          report: `未找到「${args.name}」。${note()}`,
        };
      }
      const card = computeScorecard(inputs.repo, inputs.npm, inputs.files);
      const extra = note();
      return {
        name: card.name, score: card.score, grade: card.grade, blocked: card.blocked,
        verdict: card.verdict, report: formatScoreReport(card, extra),
      };
    },
    presentCall: (args) => ({ card: "generic", title: `体检 ${args.name}`, kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "plugin_top",
    description: "dsh-plugin 生态榜单：按评分/star/最近更新排序。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          sort: { type: "string", enum: ["score", "stars", "updated"], description: "排序方式，默认 score" },
          limit: { type: "number", description: "数量 1-50，默认 10" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "number" },
          table: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.table }],
    },
    execute: async (args) => {
      const data = await syncCatalog({ token: opts.token, max: opts.max });
      const sort = args.sort || "score";
      const limit = Math.max(1, Math.min(50, args.limit || 10));
      const scored = data.repos.map((repo) => ({
        ...computeScorecard(repo, { exists: false }, { readmeLength: 0, packageJson: null }),
        pushedAt: repo.pushedAt, stars: repo.stars, description: repo.description,
      }));
      scored.sort((a, b) =>
        sort === "stars" ? b.stars - a.stars
        : sort === "updated" ? new Date(b.pushedAt) - new Date(a.pushedAt)
        : b.score - a.score);
      const top = scored.slice(0, limit);
      return { count: top.length, table: formatTopList(top) + (note() ? "\n" + note() : "") };
    },
    presentCall: (args) => ({ card: "generic", title: "插件榜单", kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "plugin_search",
    description: "按关键词在 dsh-plugin 目录中搜索插件（名称/描述），返回带评分的候选。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", required: true, description: "搜索关键词" },
          limit: { type: "number", description: "数量 1-30，默认 10" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          count: { type: "number" },
          list: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.list }],
    },
    execute: async (args) => {
      const q = String(args.query || "").toLowerCase();
      const data = await syncCatalog({ token: opts.token, max: opts.max });
      const limit = Math.max(1, Math.min(30, args.limit || 10));
      const hay = data.repos.filter((r) =>
        r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q));
      const scored = hay.map((repo) => ({
        ...computeScorecard(repo, { exists: false }, { readmeLength: 0, packageJson: null }),
        name: repo.fullName, description: repo.description, stars: repo.stars,
      }));
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit);
      return { count: top.length, list: formatSearchResults(top, args.query) };
    },
    presentCall: (args) => ({ card: "generic", title: `搜索插件 ${args.query}`, kind: "other", rawInput: args }),
  }));
}

export { Config, apply, inject, name };

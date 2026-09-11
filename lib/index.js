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
import { buildExport, mergeCatalog } from "./incremental.js";
import {
  appendSnapshot,
  buildSnapshot,
  parseHistory,
  renderHistory,
  trendOf,
} from "./history.js";
import {
  formatScoreReport, formatTopList, formatSearchResults, formatSyncSummary,
} from "./format.js";

const name = "dsh-plugin-scorecard";
const inject = ["tools", "fs"];

const Config = z.object({
  /** Optional GitHub token: raises API rate limits for catalog sync. */
  githubToken: z.string().default(""),
  /** Scan repo install scripts for risky patterns. */
  securityScan: z.boolean().default(true),
  /** In-memory catalog TTL (ms). */
  cacheTtlMs: z.number().default(900000),
  /** Max repos fetched per sync. */
  maxCatalogSize: z.number().default(200),
  /** Catalog cache file, relative to the session workspace. */
  catalogFile: z.string().default(".dsh/scorecard-catalog.json"),
  /** Score-history file, relative to the session workspace. */
  historyFile: z.string().default(".dsh/scorecard-history.json"),
  /** Keep at most this many snapshots per history file. */
  historyMaxEntries: z.number().default(100),
  /** Open-data export file, relative to the session workspace. */
  exportFile: z.string().default(".dsh/scorecard-export.json"),
});

async function resolveWorkspaceFile(ctx, file, cwd, signal) {
  const target = await ctx.fs.resolve(file, cwd !== undefined ? { cwd, signal } : { signal });
  if (cwd !== undefined) {
    const cwdTarget = await ctx.fs.resolve(".", { cwd, signal });
    if (!ctx.fs.contains(cwdTarget, target)) {
      throw new Error('scorecard: file "' + file + '" escapes the session workspace');
    }
  }
  return target;
}

function apply(ctx, config) {
  const opts = {
    token: config.githubToken || "",
    securityScan: config.securityScan,
    max: config.maxCatalogSize,
  };
  const { cacheTtlMs, catalogFile, historyFile, historyMaxEntries, exportFile } = config;
  const note = () => rateHint(opts.token) ?? "";

  ctx.tools.register(defineTool({
    name: "plugin_sync_catalog",
    description: "同步 dsh-plugin 生态目录（GitHub topic 仓库列表），供后续 audit/top/search 使用。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          incremental: { type: "boolean", description: "只合并变更的仓库（默认 true）" },
        },
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
          delta: { type: "string" },
          note: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `已同步 ${value.count} 个插件${value.truncated ? "（截断）" : ""}。${value.delta ? "增量：" + value.delta + "。" : ""}${value.note || ""}` }],
    },
    execute: async (args, exec) => {
      const cwd = exec.agent?.session?.header?.cwd;
      const catPath = await resolveWorkspaceFile(ctx, catalogFile, cwd, exec.signal);
      const catInfo = await ctx.fs.stat(catPath, exec.signal);
      let cachedDoc = null;
      if (catInfo !== undefined) {
        try { cachedDoc = JSON.parse(await ctx.fs.readText(catPath, exec.signal)); } catch { cachedDoc = null; }
      }
      const incremental = args.incremental === undefined ? true : !!args.incremental;
      if (cachedDoc && Array.isArray(cachedDoc.repos) && cachedDoc.syncedAt) {
        const age = Date.now() - new Date(cachedDoc.syncedAt).getTime();
        if (age < cacheTtlMs) {
          return { syncedAt: cachedDoc.syncedAt, count: cachedDoc.count, truncated: !!cachedDoc.truncated, delta: "命中缓存", note: note() };
        }
      }
      const data = await syncCatalog({ token: opts.token, max: opts.max });
      const prevRepos = cachedDoc && Array.isArray(cachedDoc.repos) ? cachedDoc.repos : [];
      const merged = incremental && prevRepos.length > 0
        ? mergeCatalog({ cached: prevRepos, fresh: data.repos, truncated: data.truncated })
        : { repos: data.repos, delta: { added: data.repos.length, updated: 0, unchanged: 0, missing: 0 } };
      try {
        await ctx.fs.writeText(catPath, JSON.stringify({ syncedAt: data.syncedAt, count: merged.repos.length, truncated: data.truncated, repos: merged.repos }, null, 2), undefined, exec.signal);
      } catch { /* cache write failure is non-fatal */ }
      const deltaText = "新增 " + merged.delta.added + " / 更新 " + merged.delta.updated + " / 未变 " + merged.delta.unchanged + (merged.delta.missing > 0 ? " / 移出 " + merged.delta.missing : "");
      return { syncedAt: data.syncedAt, count: merged.repos.length, truncated: data.truncated, delta: deltaText, note: note() };
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
    execute: async (args, exec) => {
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
      try {
        const cwd = exec.agent?.session?.header?.cwd;
        const histPath = await resolveWorkspaceFile(ctx, historyFile, cwd, exec.signal);
        const hInfo = await ctx.fs.stat(histPath, exec.signal);
        const existing = hInfo !== undefined ? await ctx.fs.readText(histPath, exec.signal) : "";
        const snapshot = buildSnapshot({ name: card.name, score: card.score, grade: card.grade });
        const next = appendSnapshot({ existing, snapshot, maxEntries: historyMaxEntries });
        await ctx.fs.writeText(histPath, next, undefined, exec.signal);
      } catch { /* history write failure must not break the audit */ }
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

  ctx.tools.register(defineTool({
    name: "plugin_history",
    description: "查看指定插件的历史评分曲线（时间/分数/等级、趋势方向），数据来自历次 plugin_audit 快照。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", required: true, description: "插件名称" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          trend: { type: "string" },
          table: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.table }],
    },
    execute: async (args, exec) => {
      const cwd = exec.agent?.session?.header?.cwd;
      const histPath = await resolveWorkspaceFile(ctx, historyFile, cwd, exec.signal);
      const hInfo = await ctx.fs.stat(histPath, exec.signal);
      const existing = hInfo !== undefined ? await ctx.fs.readText(histPath, exec.signal) : "";
      const snapshots = parseHistory({ text: existing });
      const t = trendOf({ snapshots, name: args.name });
      return { name: args.name, trend: t.direction, table: renderHistory({ snapshots, name: args.name }) };
    },
    presentCall: (args) => ({ card: "generic", title: `历史评分 ${args.name}`, kind: "other", rawInput: args }),
  }));

  ctx.tools.register(defineTool({
    name: "plugin_export",
    description: "导出 dsh-plugin 目录与评分的开放数据 JSON（默认写到会话工作区 .dsh/scorecard-export.json），便于二次分析或站点消费。",
    parameters: {
      input: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "导出文件路径（会话工作区内，可选）" },
          includeScores: { type: "boolean", description: "是否包含评分（默认 true）" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          count: { type: "number" },
          scored: { type: "number" },
          generatedAt: { type: "string" },
        },
      },
      render: (_args, value) => [{ type: "text", text: `已导出 ${value.count} 个插件（${value.scored} 个含评分）到 ${value.path}` }],
    },
    execute: async (args, exec) => {
      const cwd = exec.agent?.session?.header?.cwd;
      const catPath = await resolveWorkspaceFile(ctx, catalogFile, cwd, exec.signal);
      const catInfo = await ctx.fs.stat(catPath, exec.signal);
      let repos = [];
      let generatedAt = new Date().toISOString();
      if (catInfo !== undefined) {
        try {
          const doc = JSON.parse(await ctx.fs.readText(catPath, exec.signal));
          if (doc && Array.isArray(doc.repos)) { repos = doc.repos; generatedAt = doc.syncedAt || generatedAt; }
        } catch { /* fall through to a fresh sync */ }
      }
      if (repos.length === 0) {
        const data = await syncCatalog({ token: opts.token, max: opts.max });
        repos = data.repos;
        generatedAt = data.syncedAt;
        try {
          await ctx.fs.writeText(catPath, JSON.stringify({ syncedAt: data.syncedAt, count: data.count, truncated: data.truncated, repos: data.repos }, null, 2), undefined, exec.signal);
        } catch { /* non-fatal */ }
      }
      const scores = {};
      if (args.includeScores === undefined || args.includeScores) {
        for (const repo of repos) {
          const card = computeScorecard(repo, { exists: false }, { readmeLength: 0, packageJson: null });
          scores[repo.fullName] = { score: card.score, grade: card.grade, blocked: card.blocked };
        }
      }
      const outPath = await resolveWorkspaceFile(ctx, args.path || exportFile, cwd, exec.signal);
      const doc = buildExport({ repos, scores });
      await ctx.fs.writeText(outPath, JSON.stringify(doc, null, 2), undefined, exec.signal);
      return { path: ctx.fs.processPath(outPath), count: doc.count, scored: doc.scored, generatedAt: doc.generatedAt };
    },
    presentCall: (args) => ({ card: "generic", title: "导出插件目录", kind: "other", rawInput: args }),
  }));
}

export { Config, apply, inject, name };

import test from "node:test";
import assert from "node:assert/strict";
import { formatScoreReport, formatTopList, formatSearchResults } from "../lib/format.js";

const card = {
  name: "demo/dsh-x", score: 98, grade: "A", blocked: false,
  verdict: "✅ 值得安装（质量已验证）",
  signals: { lastPush: "2 天前更新", stars: "300 star", readme: "README 完整", description: "描述完整",
    license: "有开源许可证", topics: "5 个标签", npm: "npm 近期更新", downloads: "周下载 1500", security: "无安装脚本" },
  findings: [],
  breakdown: { maintenance: 28, quality: 25, npm: 15, security: 30 },
};

test("score report contains core fields", () => {
  const md = formatScoreReport(card);
  assert.ok(md.includes("98/100"));
  assert.ok(md.includes("**A**"));
  assert.ok(md.includes("维护活跃度"));
  assert.ok(md.includes("证据链"));
});

test("top list renders a table with header", () => {
  const entries = [{ name: "a/x", score: 90, grade: "A", stars: 100, pushedAt: new Date().toISOString() }];
  const md = formatTopList(entries);
  assert.ok(md.startsWith("| # | 插件 |"));
  assert.ok(md.includes("a/x"));
});

test("empty search results are handled", () => {
  assert.ok(formatSearchResults([], "nope").includes("未找到"));
});

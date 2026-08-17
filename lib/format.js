/**
 * dsh-plugin-scorecard — pure markdown formatting for tool output.
 */
import { evidenceOf } from "./scorer.js";

/** One-plugin audit report as markdown. */
export function formatScoreReport(card, extra = "") {
  const lines = [];
  lines.push(`## 📊 ${card.name}`);
  lines.push(`**得分 ${card.score}/100** · 等级 **${card.grade}** · ${card.verdict}`);
  if (card.blocked) lines.push("> 🚨 命中高危模式：不建议安装，除非你能完全审查其安装脚本。");
  lines.push("");
  lines.push("| 维度 | 得分/满分 | 信号 |");
  lines.push("|---|---|---|");
  lines.push(`| 维护活跃度 | ${card.breakdown.maintenance}/30 | ${card.signals.lastPush ?? "-"}；${card.signals.stars ?? "-"} |`);
  lines.push(`| 文档质量 | ${card.breakdown.quality}/25 | ${card.signals.readme ?? "-"}；${card.signals.description ?? "-"}；${card.signals.license ?? "-"}；${card.signals.topics ?? "-"} |`);
  lines.push(`| npm 可装性 | ${card.breakdown.npm}/15 | ${card.signals.npm ?? "-"}；${card.signals.downloads ?? "-"} |`);
  lines.push(`| 安全 | ${card.breakdown.security}/30 | ${card.signals.security ?? "-"} |`);
  const ev = evidenceOf(card);
  lines.push("");
  lines.push("**证据链**：");
  if (ev.length) {
    for (const e of ev) lines.push(`- ${e}`);
  } else {
    lines.push("- 未发现扣分项 / 无风险证据");
  }
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

/** Ranking table for plugin_top. */
export function formatTopList(entries) {
  const lines = ["| # | 插件 | 得分 | 等级 | star | 最近更新 |", "|---|---|---|---|---|---|"];
  entries.forEach((e, i) => {
    const days = Math.max(0, Math.floor((Date.now() - new Date(e.pushedAt).getTime()) / 86400000));
    lines.push(`| ${i + 1} | ${e.name} | ${e.score} | ${e.grade} | ${e.stars} | ${days} 天前 |`);
  });
  return lines.join("\n");
}

/** Search result list. */
export function formatSearchResults(entries, query) {
  if (!entries.length) return `未找到匹配「${query}」的插件。`;
  const lines = [`找到 ${entries.length} 个匹配「${query}」的插件：`, ""];
  for (const e of entries) {
    lines.push(`- **${e.name}** ${e.score} 分 [${e.grade}]${e.blocked ? " 🚨" : ""} — ${(e.description || "").slice(0, 80)}`);
  }
  return lines.join("\n");
}

/** Compact catalog summary (sync result). */
export function formatSyncSummary(data, rateNote) {
  const lines = [];
  lines.push(`已同步 ${data.count} 个 dsh-plugin 仓库${data.truncated ? "（超出上限已截断）" : ""}，时间 ${data.syncedAt}。`);
  if (rateNote) lines.push(rateNote);
  lines.push("可用工具：plugin_audit <名称> 体检单个插件；plugin_top 看榜单；plugin_search <关键词> 搜索。");
  return lines.join("\n");
}

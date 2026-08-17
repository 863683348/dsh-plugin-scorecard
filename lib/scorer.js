/**
 * dsh-plugin-scorecard — pure scoring engine (no network, unit-testable).
 *
 * Score model (0-100):
 *   maintenance 30 | quality 25 | npm 15 | security 30
 * Grades: A >= 80, B >= 60, C >= 40, D < 40.
 * High-risk security findings veto the score: capped at 30, grade D.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Patterns that indicate a dangerous install-time script (high severity). */
const HIGH_RISK_PATTERNS = [
  /curl[^|\n]*\|\s*sh/i,
  /wget[^|\n]*\|\s*sh/i,
  /\/dev\/tcp\//i,
  /base64\s+-d/i,
  /(?:^|[;\s&])iex\s*\(/i,
  /invoke-expression/i,
  /powershell[^\n]*-(?:enc|encodedcommand)/i,
  /cmd\.exe[^\n]*\/c/i,
  /certutil\s+-urlcache/i,
];

/** Patterns that are suspicious but not necessarily blocking (low/info). */
const LOW_RISK_PATTERNS = [
  /child_process\s*\./i,
  /require\(['"]child_process['"]\)/i,
  /\beval\s*\(/i,
  /process\.env/i,
];

/** http(s) URLs to hosts other than well-known package registries (info). */
const BEACON_HOSTS = ["registry.npmjs.org", "api.github.com", "raw.githubusercontent.com", "github.com", "jsdelivr.net", "unpkg.com"];

function classifyScript(scriptText) {
  const findings = [];
  for (const p of HIGH_RISK_PATTERNS) {
    if (p.test(scriptText)) {
      findings.push({ severity: "high", text: "安装脚本命中高危模式", evidence: p.source });
    }
  }
  for (const p of LOW_RISK_PATTERNS) {
    if (p.test(scriptText)) {
      findings.push({ severity: "low", text: "安装脚本使用动态执行/子进程", evidence: p.source });
    }
  }
  const urls = scriptText.match(/https?:\/\/[^\s"')]+/g) || [];
  for (const u of urls) {
    let host = "?";
    try { host = new URL(u).hostname; } catch { /* ignore */ }
    if (!BEACON_HOSTS.includes(host)) {
      findings.push({ severity: "info", text: "安装脚本访问外部主机（可能是信标/回连）", evidence: u });
    }
  }
  return findings;
}

function maintenanceScore(repo, now) {
  const signals = {};
  let total = 0;
  if (repo.archived) {
    signals.archived = "仓库已归档";
    return { score: 0, signals, note: "已归档" };
  }
  const days = Math.max(0, Math.floor((now - new Date(repo.pushedAt).getTime()) / DAY));
  let pushScore;
  if (days <= 7) pushScore = 20; else if (days <= 30) pushScore = 16; else if (days <= 90) pushScore = 12;
  else if (days <= 180) pushScore = 8; else if (days <= 365) pushScore = 4; else pushScore = 0;
  signals.lastPush = `${days} 天前更新`;
  total += pushScore;
  const stars = repo.stars || 0;
  let starScore;
  if (stars >= 1000) starScore = 10; else if (stars >= 200) starScore = 8; else if (stars >= 50) starScore = 6;
  else if (stars >= 10) starScore = 4; else if (stars >= 1) starScore = 2; else starScore = 0;
  signals.stars = `${stars} star`;
  total += starScore;
  return { score: total, signals };
}

function qualityScore(repo, files) {
  const signals = {};
  let total = 0;
  const readmeLen = files.readmeLength ?? 0;
  if (readmeLen >= 200) { total += 10; signals.readme = "README 完整"; }
  else if (readmeLen >= 50) { total += 6; signals.readme = "README 偏短"; }
  else if (readmeLen > 0) { total += 3; signals.readme = "README 过短"; }
  else { signals.readme = "缺少 README"; }
  const descLen = (repo.description || "").length;
  if (descLen >= 60) { total += 5; signals.description = "描述完整"; }
  else if (descLen >= 20) { total += 3; signals.description = "描述一般"; }
  else if (descLen > 0) { total += 1; signals.description = "描述过短"; }
  else { signals.description = "无描述"; }
  if (repo.license) { total += 5; signals.license = "有开源许可证"; }
  else { signals.license = "缺少许可证"; }
  const topics = repo.topics || [];
  if (topics.length >= 5) { total += 5; signals.topics = `${topics.length} 个标签`; }
  else if (topics.length >= 2) { total += 3; signals.topics = `${topics.length} 个标签`; }
  else if (topics.length === 1) { total += 1; signals.topics = "1 个标签"; }
  else { signals.topics = "无标签"; }
  return { score: total, signals };
}

function npmScore(npm) {
  const signals = {};
  let total = 0;
  if (!npm || !npm.exists) {
    signals.npm = "未发布 npm 包（需 Git 安装）";
    return { score: 0, signals };
  }
  total += 8;
  const days = Math.max(0, Math.floor((Date.now() - new Date(npm.lastPublish).getTime()) / DAY));
  if (days <= 90) { total += 4; signals.npm = "npm 近期更新"; }
  else if (days <= 365) { total += 2; signals.npm = `npm ${days} 天未更新`; }
  else { signals.npm = `npm ${days} 天未更新`; }
  const dl = npm.weeklyDownloads ?? 0;
  if (dl >= 1000) { total += 3; signals.downloads = `周下载 ${dl}`; }
  else if (dl >= 100) { total += 2; signals.downloads = `周下载 ${dl}`; }
  else if (dl >= 1) { total += 1; signals.downloads = `周下载 ${dl}`; }
  else { signals.downloads = "无下载量数据"; }
  return { score: total, signals };
}

function securityScore(pkgJson) {
  const signals = {};
  let total = 30;
  const findings = [];
  if (!pkgJson) {
    signals.security = "无 package.json，未发现安装脚本";
    return { score: total, signals, findings };
  }
  const scripts = pkgJson.scripts || {};
  const installScripts = Object.entries(scripts).filter(([k]) =>
    ["install", "postinstall", "preinstall", "prepare"].includes(k));
  if (installScripts.length === 0) {
    signals.security = "无安装脚本";
    return { score: total, signals, findings };
  }
  const combined = installScripts.map(([k, v]) => `${k}: ${v}`).join("\n");
  const scriptFindings = classifyScript(combined);
  findings.push(...scriptFindings);
  const hasHigh = scriptFindings.some((f) => f.severity === "high");
  const hasBeacon = scriptFindings.some((f) => f.severity === "info");
  if (hasHigh) {
    total = 0;
    signals.security = "命中高危安装脚本模式（已拦截）";
  } else {
    total = 24;
    if (installScripts.length > 1) total = 18;
    signals.security = `检测到 ${installScripts.length} 个安装脚本${hasBeacon ? "（含外部主机访问）" : ""}`;
  }
  return { score: total, signals, findings };
}

/** Map a numeric score to a grade. */
export function gradeOf(score) {
  return score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
}

/**
 * Compute the scorecard for one plugin.
 * @param repo {{fullName, description, stars, pushedAt, createdAt, archived, license, topics, defaultBranch}}
 * @param npm {{exists, version, lastPublish, weeklyDownloads}|null}
 * @param files {{readmeLength, packageJson}|null}
 * @param now number (ms epoch, defaults to Date.now())
 */
export function computeScorecard(repo, npm, files, now = Date.now()) {
  const f = files || { readmeLength: 0, packageJson: null };
  const m = maintenanceScore(repo, now);
  const q = qualityScore(repo, f);
  const n = npmScore(npm);
  const s = securityScore(f.packageJson);
  let score = m.score + q.score + n.score + s.score;
  const blocked = s.findings.some((x) => x.severity === "high");
  if (blocked) score = Math.min(score, 30);
  const grade = gradeOf(score);
  const verdict = blocked
    ? "🚨 不推荐：命中高危安装脚本模式"
    : grade === "A" ? "✅ 值得安装（质量已验证）"
    : grade === "B" ? "👍 可用，建议检查配置"
    : grade === "C" ? "⚠️ 谨慎：存在明显短板"
    : "🚨 不推荐：严重缺陷或高风险";
  return {
    name: repo.fullName,
    score,
    grade,
    blocked,
    verdict,
    signals: { ...m.signals, ...q.signals, ...n.signals, ...s.signals },
    findings: s.findings,
    breakdown: { maintenance: m.score, quality: q.score, npm: n.score, security: s.score },
    generatedAt: new Date(now).toISOString(),
  };
}

/** Build a human-readable evidence list from a scorecard. */
export function evidenceOf(card) {
  const lines = [];
  if (card.breakdown.maintenance === 0 && card.signals.archived) lines.push("仓库已归档");
  for (const [k, v] of Object.entries(card.signals)) {
    if (k === "archived") continue;
    if (k === "security" && v.startsWith("命中高危")) lines.push(v);
  }
  for (const f of card.findings) lines.push(`[${f.severity}] ${f.text}：${f.evidence}`);
  return lines;
}

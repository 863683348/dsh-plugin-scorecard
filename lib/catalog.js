/**
 * dsh-plugin-scorecard — runtime data layer (network at runtime in the
 * user's DSH environment). Fetches the GitHub dsh-plugin topic, npm
 * registry metadata and repo files, with an in-memory TTL cache.
 * Pure scoring lives in scorer.js; this module never scores.
 */

const GITHUB_API = "https://api.github.com";
const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";
const UA = "dsh-plugin-scorecard/0.1.0";

const cache = new Map(); // key -> { at, data }
const CACHE_TTL = 15 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL) { cache.delete(key); return undefined; }
  return hit.data;
}
function cacheSet(key, data) { cache.set(key, { at: Date.now(), data }); }

async function gh(path, token, timeoutMs = 15000) {
  const headers = { "User-Agent": UA, Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GITHUB_API + path, { headers, signal: ctrl.signal });
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get("x-ratelimit-reset");
      throw new Error(`GitHub API 限流（${res.status}），reset: ${reset ?? "未知"}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function mapRepo(r) {
  return {
    fullName: r.full_name,
    name: r.name,
    description: r.description || "",
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssues: r.open_issues_count ?? 0,
    pushedAt: r.pushed_at || r.updated_at || new Date(0).toISOString(),
    createdAt: r.created_at || new Date(0).toISOString(),
    archived: !!r.archived,
    license: r.license && r.license.spdx_id ? r.license.spdx_id : null,
    topics: r.topics || [],
    defaultBranch: r.default_branch || "main",
  };
}

/** Fetch the dsh-plugin topic catalog (star-sorted, capped). */
export async function syncCatalog({ token = "", max = 200 } = {}) {
  const cached = cacheGet("catalog");
  if (cached) return cached;
  const perPage = Math.min(100, Math.max(1, max));
  const q = encodeURIComponent("topic:dsh-plugin");
  const first = await gh(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}`, token);
  if (!first) throw new Error("GitHub 搜索失败");
  let repos = (first.items || []).map(mapRepo);
  let truncated = false;
  if (repos.length < max && first.total_count > repos.length) {
    const page2 = await gh(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=${perPage}&page=2`, token).catch(() => null);
    if (page2 && page2.items) repos = repos.concat(page2.items.map(mapRepo));
  }
  if (repos.length > max) { repos = repos.slice(0, max); truncated = true; }
  const data = { syncedAt: new Date().toISOString(), count: repos.length, truncated, repos };
  cacheSet("catalog", data);
  return data;
}

/** Locate a plugin by "owner/repo", bare repo name, or npm package name. */
export async function findPlugin(identifier, { token = "" } = {}) {
  const cached = cacheGet(`find:${identifier}`);
  if (cached) return cached;
  let repo = null;
  const id = identifier.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
  if (id.includes("/")) {
    const r = await gh(`/repos/${encodeURIComponent(id)}`, token);
    repo = r ? mapRepo(r) : null;
  } else {
    const q = encodeURIComponent(`${id} in:name topic:dsh-plugin`);
    const res = await gh(`/search/repositories?q=${q}&per_page=5`, token);
    const cands = ((res && res.items) || []).map(mapRepo);
    repo = cands.find((c) => c.name.toLowerCase() === id.toLowerCase()) || cands[0] || null;
  }
  if (!repo) { cacheSet(`find:${identifier}`, null); return null; }
  cacheSet(`find:${identifier}`, repo);
  return repo;
}

/** npm registry metadata for a repo name. */
async function fetchNpm(name, token = "") {
  const ck = `npm:${name}`;
  const cached = cacheGet(ck);
  if (cached !== undefined) return cached;
  let data = null;
  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(name)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const pkg = await res.json();
      const latest = pkg["dist-tags"] && pkg["dist-tags"].latest;
      const ver = latest ? pkg.versions && pkg.versions[latest] : undefined;
      data = {
        exists: true,
        name: pkg.name,
        version: latest || "?",
        lastPublish: ver && ver.gitHead ? undefined : (pkg.time && pkg.time[latest]) || new Date(0).toISOString(),
      };
    } else {
      data = { exists: false };
    }
  } catch {
    data = { exists: false, error: "npm registry 不可达" };
  }
  if (data && data.exists && data.name) {
    try {
      const dl = await fetch(`${NPM_DOWNLOADS}/${encodeURIComponent(data.name)}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10000),
      });
      if (dl.ok) { const j = await dl.json(); data.weeklyDownloads = j.downloads || 0; }
    } catch { data.weeklyDownloads = 0; }
  }
  cacheSet(ck, data);
  return data;
}

/** Fetch README length and package.json (for security scan) via raw content. */
async function fetchFiles(repo, { securityScan = true } = {}) {
  const readme = await gh(`/repos/${repo.fullName}/readme`, "", 10000).catch(() => null);
  let readmeLength = 0;
  if (readme && readme.content) {
    try { readmeLength = Buffer.from(readme.content, "base64").toString("utf8").length; } catch { readmeLength = 0; }
  }
  let packageJson = null;
  if (securityScan) {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${repo.fullName}/${repo.defaultBranch}/package.json`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) },
    ).catch(() => null);
    if (raw && raw.ok) {
      try { packageJson = await raw.json(); } catch { packageJson = null; }
    }
  }
  return { readmeLength, packageJson };
}

/** Full audit inputs for one plugin. */
export async function auditInputs(identifier, { token = "", securityScan = true } = {}) {
  const repo = await findPlugin(identifier, { token });
  if (!repo) return null;
  const npm = await fetchNpm(repo.name, token);
  const files = await fetchFiles(repo, { securityScan });
  return { repo, npm, files };
}

/** Convenience for callers: GitHub token configured or not (rate hints). */
export function rateHint(token) {
  return token ? undefined : "未配置 GitHub Token（GitHub API 60 次/小时，可在插件配置 githubToken 提升）。";
}

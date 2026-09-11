/**
 * dsh-plugin-scorecard — pure incremental-sync and open-data helpers.
 *
 * No DSH/Cordis imports, no network: merging a fresh catalog into the cached
 * one and building the export document are unit-testable in isolation.
 */

/** Merge a fresh catalog into the cached one and report the delta. */
export function mergeCatalog({ cached = [], fresh = [], truncated = false } = {}) {
  const cachedList = Array.isArray(cached) ? cached.filter((r) => r && r.fullName) : [];
  const freshList = Array.isArray(fresh) ? fresh.filter((r) => r && r.fullName) : [];
  const byName = new Map(cachedList.map((r) => [r.fullName, r]));
  const cachedNames = new Set(byName.keys());
  const added = [];
  const updated = [];
  const unchanged = [];
  const seen = new Set();
  for (const repo of freshList) {
    seen.add(repo.fullName);
    const prev = byName.get(repo.fullName);
    if (prev === undefined) {
      added.push(repo.fullName);
      byName.set(repo.fullName, repo);
    } else if (prev.pushedAt !== repo.pushedAt || (prev.stars ?? 0) !== (repo.stars ?? 0)) {
      updated.push(repo.fullName);
      byName.set(repo.fullName, repo);
    } else {
      unchanged.push(repo.fullName);
    }
  }
  const missing = [...cachedNames].filter((n) => !seen.has(n));
  if (!truncated) for (const n of missing) byName.delete(n);
  const repos = [...byName.values()];
  return {
    repos,
    added,
    updated,
    unchanged,
    missing,
    delta: { added: added.length, updated: updated.length, unchanged: unchanged.length, missing: missing.length },
  };
}

/** Build the open-data export document (catalog + optional scores). */
export function buildExport({ repos = [], scores = {}, generatedAt = new Date().toISOString(), source = "dsh-plugin-scorecard" } = {}) {
  const list = Array.isArray(repos) ? repos.filter((r) => r && r.fullName) : [];
  const map = scores && typeof scores === "object" ? scores : {};
  const entries = list.map((r) => {
    const s = map[r.fullName] || map[r.name];
    return {
      fullName: r.fullName,
      name: r.name,
      description: r.description || "",
      stars: r.stars ?? 0,
      forks: r.forks ?? 0,
      pushedAt: r.pushedAt || "",
      license: r.license || null,
      topics: Array.isArray(r.topics) ? r.topics : [],
      score: s && typeof s.score === "number" ? s.score : null,
      grade: s && s.grade ? s.grade : null,
      blocked: s ? !!s.blocked : null,
    };
  });
  entries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.stars - a.stars || a.fullName.localeCompare(b.fullName));
  const scored = entries.filter((e) => e.score !== null).length;
  return { source, generatedAt, count: entries.length, scored, entries };
}

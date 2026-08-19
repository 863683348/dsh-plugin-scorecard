/**
 * dsh-plugin-scorecard — pure score-history helpers: snapshot model,
 * JSON-lines persistence format, trend detection and markdown rendering.
 *
 * No DSH/Cordis imports here, so this module is unit-testable in isolation.
 */

const HISTORY_HEADER = "# Scorecard History";
const HISTORY_TAG = "<!-- dsh-scorecard-history -->";

/** Build one audit snapshot. */
export function buildSnapshot({ name = "", ts = new Date().toISOString(), score = 0, grade = "?", signals = [] } = {}) {
  return { name: String(name), ts: String(ts), score: Number(score) || 0, grade: String(grade || "?"), signals: Array.isArray(signals) ? signals : [] };
}

/** Parse JSON-lines history text into snapshots (skips malformed lines). */
export function parseHistory({ text = "" } = {}) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const s = JSON.parse(trimmed);
      if (s && typeof s.name === "string") out.push(s);
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Serialize snapshots to JSON-lines history text. */
export function serializeHistory(snapshots = []) {
  const lines = snapshots.map((s) => JSON.stringify(s));
  return HISTORY_HEADER + "\n\n" + HISTORY_TAG + "\n\n" + lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/** Append a snapshot, keeping the newest entries. */
export function appendSnapshot({ existing = "", snapshot = {}, maxEntries = 100 } = {}) {
  const snapshots = parseHistory({ text: existing });
  snapshots.push(snapshot);
  const kept = snapshots.slice(-Math.max(1, Math.floor(maxEntries)));
  return serializeHistory(kept);
}

/** Trend direction for a plugin's score series. */
export function trendOf({ snapshots = [], name = "" } = {}) {
  const series = snapshots.filter((s) => s && s.name === name);
  if (series.length < 2) return { direction: "flat", change: 0, samples: series.length };
  const first = series[0].score;
  const last = series[series.length - 1].score;
  const change = Math.round((last - first) * 100) / 100;
  const direction = change > 0.5 ? "up" : change < -0.5 ? "down" : "flat";
  return { direction, change, samples: series.length };
}

/** Render a plugin's score timeline as markdown. */
export function renderHistory({ snapshots = [], name = "" } = {}) {
  const series = snapshots.filter((s) => s && s.name === name);
  if (series.length === 0) return "(no history for " + name + " — run plugin_audit first)";
  const t = trendOf({ snapshots, name });
  const arrow = t.direction === "up" ? "up" : t.direction === "down" ? "down" : "flat";
  const lines = [
    "# Score history: " + name,
    "",
    "Trend: " + arrow + " (" + (t.change >= 0 ? "+" : "") + t.change + " over " + t.samples + " sample(s))",
    "",
    "| Time | Score | Grade |",
    "|------|-------|-------|",
    ...series.map((s) => "| " + String(s.ts).slice(0, 19).replace("T", " ") + " | " + s.score + " | " + s.grade + " |"),
  ];
  return lines.join("\n");
}

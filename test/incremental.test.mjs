import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, mergeCatalog } from "../lib/incremental.js";

const cached = [
  { fullName: "a/one", name: "one", stars: 5, pushedAt: "2026-01-01", description: "d1", topics: ["x"] },
  { fullName: "a/two", name: "two", stars: 3, pushedAt: "2026-01-02" },
  { fullName: "a/gone", name: "gone", stars: 1, pushedAt: "2026-01-03" },
];
const fresh = [
  { fullName: "a/one", name: "one", stars: 5, pushedAt: "2026-01-01", description: "d1", topics: ["x"] },
  { fullName: "a/two", name: "two", stars: 9, pushedAt: "2026-02-02" },
  { fullName: "a/new", name: "new", stars: 2, pushedAt: "2026-02-03" },
];

test("mergeCatalog classifies added/updated/unchanged/missing", () => {
  const m = mergeCatalog({ cached, fresh });
  assert.deepEqual(m.delta, { added: 1, updated: 1, unchanged: 1, missing: 1 });
  assert.deepEqual(m.added, ["a/new"]);
  assert.deepEqual(m.updated, ["a/two"]);
  assert.deepEqual(m.unchanged, ["a/one"]);
  assert.deepEqual(m.missing, ["a/gone"]);
});

test("mergeCatalog drops missing repos on a complete sync", () => {
  const m = mergeCatalog({ cached, fresh });
  assert.equal(m.repos.length, 3);
  assert.ok(!m.repos.some((r) => r.fullName === "a/gone"));
});

test("mergeCatalog keeps missing repos when the sync was truncated", () => {
  const m = mergeCatalog({ cached, fresh, truncated: true });
  assert.equal(m.repos.length, 4);
  assert.deepEqual(m.missing, ["a/gone"]);
});

test("mergeCatalog handles empty inputs", () => {
  const m = mergeCatalog({ cached: [], fresh: [] });
  assert.equal(m.repos.length, 0);
  assert.deepEqual(m.delta, { added: 0, updated: 0, unchanged: 0, missing: 0 });
  const first = mergeCatalog({ cached: [], fresh });
  assert.equal(first.delta.added, 3);
});

test("mergeCatalog detects star-only changes", () => {
  const m = mergeCatalog({ cached: [{ fullName: "a/x", name: "x", stars: 1, pushedAt: "2026-01-01" }], fresh: [{ fullName: "a/x", name: "x", stars: 7, pushedAt: "2026-01-01" }] });
  assert.equal(m.delta.updated, 1);
});

test("buildExport sorts by score then stars and marks unscored", () => {
  const doc = buildExport({
    repos: [
      { fullName: "a/one", name: "one", stars: 5, pushedAt: "2026-01-01", topics: ["x"], license: "MIT" },
      { fullName: "a/two", name: "two", stars: 3, pushedAt: "2026-01-02" },
      { fullName: "a/three", name: "three", stars: 90, pushedAt: "2026-01-03" },
    ],
    scores: { "a/two": { score: 88, grade: "A", blocked: false } },
    generatedAt: "2026-08-22T00:00:00Z",
  });
  assert.equal(doc.count, 3);
  assert.equal(doc.scored, 1);
  assert.equal(doc.entries[0].fullName, "a/two", "scored entry ranks first");
  assert.equal(doc.entries[0].score, 88);
  assert.equal(doc.entries[0].grade, "A");
  const unscored = doc.entries.find((e) => e.fullName === "a/three");
  assert.equal(unscored.score, null);
  assert.equal(unscored.blocked, null);
  assert.equal(doc.generatedAt, "2026-08-22T00:00:00Z");
  assert.equal(doc.source, "dsh-plugin-scorecard");
});

test("buildExport accepts name-keyed scores and empty input", () => {
  const doc = buildExport({ repos: [{ fullName: "a/one", name: "one" }], scores: { one: { score: 50, grade: "C" } } });
  assert.equal(doc.entries[0].score, 50);
  const empty = buildExport({ repos: [] });
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.entries, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSnapshot,
  buildSnapshot,
  parseHistory,
  renderHistory,
  serializeHistory,
  trendOf,
} from "../lib/history.js";

test("buildSnapshot normalizes fields", () => {
  const s = buildSnapshot({ name: "a/b", score: 72.4, grade: "B", signals: ["x"] });
  assert.equal(s.name, "a/b");
  assert.equal(s.score, 72.4);
  assert.equal(s.grade, "B");
  const bad = buildSnapshot({ name: "x", score: "nope" });
  assert.equal(bad.score, 0);
});

test("serialize/parse round-trip", () => {
  const snapshots = [
    buildSnapshot({ name: "a/b", ts: "2026-08-01T00:00:00.000Z", score: 60, grade: "C" }),
    buildSnapshot({ name: "a/b", ts: "2026-08-02T00:00:00.000Z", score: 75, grade: "B" }),
  ];
  const text = serializeHistory(snapshots);
  assert.ok(text.startsWith("# Scorecard History"));
  const parsed = parseHistory({ text });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].score, 75);
});

test("parseHistory skips malformed lines", () => {
  const parsed = parseHistory({ text: "# header\n\nnot json\n{\"name\":\"ok\",\"score\":1}\n" });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "ok");
});

test("appendSnapshot keeps newest and caps entries", () => {
  let text = "";
  for (let i = 1; i <= 5; i++) {
    const s = buildSnapshot({ name: "a/b", ts: "2026-08-0" + i + "T00:00:00.000Z", score: i * 10, grade: "B" });
    text = appendSnapshot({ existing: text, snapshot: s, maxEntries: 3 });
  }
  const parsed = parseHistory({ text });
  assert.equal(parsed.length, 3, "capped at 3");
  assert.equal(parsed[parsed.length - 1].score, 50, "newest kept");
});

test("trendOf detects up/down/flat", () => {
  const up = trendOf({ snapshots: [
    buildSnapshot({ name: "x", score: 50 }), buildSnapshot({ name: "x", score: 70 }),
  ], name: "x" });
  assert.equal(up.direction, "up");
  assert.equal(up.change, 20);
  const down = trendOf({ snapshots: [
    buildSnapshot({ name: "x", score: 70 }), buildSnapshot({ name: "x", score: 40 }),
  ], name: "x" });
  assert.equal(down.direction, "down");
  const flat = trendOf({ snapshots: [
    buildSnapshot({ name: "x", score: 50 }), buildSnapshot({ name: "x", score: 50 }),
  ], name: "x" });
  assert.equal(flat.direction, "flat");
  const single = trendOf({ snapshots: [buildSnapshot({ name: "x", score: 50 })], name: "x" });
  assert.equal(single.samples, 1);
  assert.equal(single.direction, "flat");
});

test("trendOf filters by name", () => {
  const t = trendOf({ snapshots: [
    buildSnapshot({ name: "a", score: 10 }), buildSnapshot({ name: "b", score: 90 }),
  ], name: "a" });
  assert.equal(t.samples, 1);
});

test("renderHistory produces a timeline table", () => {
  const snapshots = [
    buildSnapshot({ name: "a/b", ts: "2026-08-01T00:00:00.000Z", score: 60, grade: "C" }),
    buildSnapshot({ name: "a/b", ts: "2026-08-02T00:00:00.000Z", score: 75, grade: "B" }),
  ];
  const out = renderHistory({ snapshots, name: "a/b" });
  assert.ok(out.startsWith("# Score history: a/b"));
  assert.ok(out.includes("| Time | Score | Grade |"));
  assert.ok(out.includes("| 2026-08-01 00:00:00 | 60 | C |"));
  assert.ok(out.includes("Trend: up"));
  const empty = renderHistory({ snapshots, name: "nope" });
  assert.ok(empty.includes("no history"));
});

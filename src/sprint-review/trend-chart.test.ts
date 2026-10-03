import assert from "node:assert/strict";
import test from "node:test";
import { buildTrendChartSvg } from "./trend-chart";
import type { SprintReviewDocument } from "./document";

const TREND: SprintReviewDocument["trend"] = {
  windowSize: 5,
  averageCompleted: 12.5,
  averageCommitted: 17.5,
  reliabilityPercent: 71.4,
  currentReliabilityPercent: 17.9,
  sprints: [
    { name: "Sprint 1", completed: 8, committed: 13, reliabilityPercent: 61.5 },
    { name: "Sprint 2", completed: 21, committed: 21, reliabilityPercent: 100 },
    { name: "Sprint <3>", completed: null, committed: null, reliabilityPercent: null },
  ],
};

test("buildTrendChartSvg draws a committed track and a completed column per sprint", () => {
  const svg = buildTrendChartSvg(TREND);

  assert.match(svg, /^<svg [^>]*viewBox="0 0 1200 300"/);
  assert.equal((svg.match(/fill="#ef8796"/g) ?? []).length, 2);
  assert.equal((svg.match(/fill="#ed1a3a"/g) ?? []).length, 2);
  assert.match(svg, /<title>Sprint 1 — 8 of 13 points \(61\.5%\)<\/title>/);
  assert.match(svg, /<title>Sprint &lt;3&gt; — no estimates<\/title>/);
  assert.match(svg, />avg 12\.5<\/text>/);
});

test("buildTrendChartSvg uses round axis ticks up to the largest value", () => {
  const svg = buildTrendChartSvg(TREND);
  const ticks = [...svg.matchAll(/text-anchor="end" font-size="12"[^>]*>(\d+)<\/text>/g)].map((match) => Number(match[1]));

  assert.deepEqual(ticks, [0, 5, 10, 15, 20, 25]);
});

test("buildTrendChartSvg returns nothing without closed sprints", () => {
  assert.equal(buildTrendChartSvg({ ...TREND, sprints: [] }), "");
});

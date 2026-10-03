import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverSvg, parseSprintTheme, pickCoverStyle } from "./cover";

test("parseSprintTheme takes the text after the last colon as the theme", () => {
  assert.deepEqual(parseSprintTheme("PI#7 - IP : Orion"), { label: "PI#7 - IP", theme: "Orion" });
  assert.deepEqual(parseSprintTheme("Sprint 12"), { label: "", theme: "Sprint 12" });
  assert.deepEqual(parseSprintTheme("Release : "), { label: "", theme: "Release" });
  assert.deepEqual(parseSprintTheme("   "), { label: "", theme: "Sprint" });
});

test("buildCoverSvg is deterministic for a sprint name", () => {
  assert.equal(buildCoverSvg("PI#7 - IP : Orion"), buildCoverSvg("PI#7 - IP : Orion"));
  assert.notEqual(buildCoverSvg("PI#7 - IP : Orion"), buildCoverSvg("PI#7 - IP : Hyperion"));
});

test("sprints sharing a theme share the cover pattern", () => {
  assert.equal(pickCoverStyle("PI#7 - S1 : Orion"), pickCoverStyle("PI#8 - S4 : orion"));
});

test("buildCoverSvg is a text-free portrait pattern with an escaped label", () => {
  const svg = buildCoverSvg("PI#7 <b> : R&D");

  assert.match(svg, /^<svg [^>]*viewBox="0 0 600 800"/);
  assert.match(svg, /aria-label="Cover art for R&amp;D"/);
  assert.doesNotMatch(svg, /<text/);
  assert.doesNotMatch(svg, /<b>/);
});

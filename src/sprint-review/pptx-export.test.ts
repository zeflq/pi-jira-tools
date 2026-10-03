import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { applyAssessment } from "./assessment";
import { buildSprintReviewDocument, type SprintReviewDocument } from "./document";
import { buildSprintReviewPptx, buildSprintReviewPptxFileName } from "./pptx-export";
import type { JiraSprintReviewIssue, JiraSprintReviewSnapshot, TeamVelocitySeries } from "../jira/types";

function issue(key: string, summary: string, status: string, estimate: number | null, category: JiraSprintReviewIssue["statusCategory"]): JiraSprintReviewIssue {
  return { key, summary, status, issueType: "Story", priority: "Major", estimate, statusCategory: category };
}

const VELOCITY: TeamVelocitySeries = {
  boardId: "42",
  windowSize: 5,
  includeAddedDuringSprint: true,
  averageCompletedPoints: 12.5,
  averageCommittedPoints: 17.5,
  reliabilityPercent: 71.4,
  points: [
    { sprintId: "1", sprintName: "Sprint 1", startDate: null, endDate: null, completedPoints: 8, committedPoints: 13, reliabilityPercent: 61.5, includeAddedDuringSprint: true },
    { sprintId: "2", sprintName: "Sprint 2", startDate: null, endDate: null, completedPoints: 21, committedPoints: 21, reliabilityPercent: 100, includeAddedDuringSprint: true },
  ],
};

function makeDocument(openCount = 2, velocity: TeamVelocitySeries = VELOCITY): SprintReviewDocument {
  const snapshot: JiraSprintReviewSnapshot = {
    projectKey: "PROJ",
    boardId: "42",
    board: { id: "42", self: null, name: "Test Board", type: "scrum", projectKey: "PROJ", projectName: "Test", projectType: "software" },
    sprint: {
      id: "7",
      self: null,
      name: "PI#7 - IP : Orion",
      state: "active",
      startDate: "2026-10-05T09:00:00.000Z",
      endDate: "2026-10-16T17:00:00.000Z",
      completeDate: null,
      activatedDate: null,
      goal: "- Ship Payments-V2\n- Search revamp",
      originBoardId: "42",
    },
    metrics: {
      completedIssueCount: 0,
      notCompletedIssueCount: 0,
      puntedIssueCount: 0,
      completedInAnotherSprintIssueCount: 0,
      totalIssueCount: 0,
      addedDuringSprintCount: 0,
      removedDuringSprintCount: 0,
      statusCounts: {},
      estimateStatistics: null,
    },
    completedIssues: [issue("PROJ-1", "[Payments v2][Back] refunds <API> & retries", "Done", 5, "done")],
    notCompletedIssues: Array.from({ length: openCount }, (_, index) =>
      issue(`PROJ-${index + 10}`, `[Search][Front] open item ${index + 1}`, "In Progress", 3, "indeterminate")
    ),
    puntedIssues: [],
    completedInAnotherSprintIssues: [],
    issueKeysAddedDuringSprint: [],
    issueKeysRemovedDuringSprint: [],
  };
  return buildSprintReviewDocument(snapshot, velocity, {
    includeAddedDuringSprint: true,
    cancelledStatuses: [],
    almostDoneStatuses: [],
    now: new Date("2026-10-14T10:00:00Z"),
  });
}

async function readDeck(document: SprintReviewDocument) {
  const zip = await JSZip.loadAsync(await buildSprintReviewPptx(document));
  const files = Object.keys(zip.files);
  const read = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");
  const slidePaths = files.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/g)?.at(-1)) - Number(b.match(/\d+/g)?.at(-1)));
  const slides = await Promise.all(slidePaths.map(read));
  const notes = await Promise.all(files.filter((path) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path)).sort().map(read));
  const charts = await Promise.all(files.filter((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path)).map(read));
  return { slides, notes, charts, files };
}

test("buildSprintReviewPptx writes the five slides with the document's numbers", async () => {
  const { slides } = await readDeck(makeDocument());

  assert.equal(slides.length, 5);
  assert.match(slides[0] ?? "", /PI#7 - IP : Orion/);
  assert.match(slides[0] ?? "", />ORION</);
  assert.match(slides[1] ?? "", /Did we achieve the objective\?/);
  assert.match(slides[1] ?? "", /Ship Payments-V2/);
  assert.match(slides[2] ?? "", /PROJ-1/);
  // Ticket titles are XML-escaped, not injected.
  assert.match(slides[2] ?? "", /refunds &lt;API&gt; &amp; retries/);
  assert.match(slides[3] ?? "", /PROJ-10/);
  assert.match(slides[4] ?? "", /How reliable are our commitments\?/);
  assert.match(slides[4] ?? "", />71\.4%</);
});

test("buildSprintReviewPptx draws the trend as a native chart with the sprint values", async () => {
  const { charts } = await readDeck(makeDocument());
  const chart = charts.join("");

  assert.ok(charts.length >= 1);
  assert.match(chart, /Committed points/);
  assert.match(chart, /Completed points/);
  assert.match(chart, /<c:v>21<\/c:v>/);
  assert.match(chart, /Average completed \(12\.5\)/);
});

test("buildSprintReviewPptx continues long ticket tables on extra slides", async () => {
  const { slides } = await readDeck(makeDocument(14));

  // 14 open tickets: 6 on the slipped slide, then 8 on one continuation slide.
  assert.equal(slides.length, 6);
  assert.match(slides[4] ?? "", /What is still open\? \(continued\)/);
  assert.match(slides[4] ?? "", /PROJ-23/);
});

test("buildSprintReviewPptx puts the LLM summary and goal reasons in the speaker notes", async () => {
  const document = makeDocument();
  const assessed = applyAssessment(document, {
    model: "test-model",
    summary: "Payments landed; search slipped.",
    teamRules: true,
    goals: [
      { goal: "Ship Payments-V2", status: "achieved", confidence: "high", evidence: ["PROJ-1"], rationale: "PROJ-1 is done." },
      { goal: "Search revamp", status: "not_achieved", confidence: "medium", evidence: ["PROJ-10"], rationale: "Still in progress." },
    ],
  });
  const { slides, notes } = await readDeck(assessed);

  assert.match(slides[1] ?? "", /assessed by test-model · with team rules/i);
  assert.match(slides[1] ?? "", /PROJ-1 is done\./);
  assert.match(notes.join(""), /Payments landed; search slipped\./);
  assert.match(notes.join(""), /Search revamp — not achieved: Still in progress\./);
});

test("buildSprintReviewPptx handles a board without closed sprints", async () => {
  const { slides, charts } = await readDeck(makeDocument(2, { ...VELOCITY, averageCompletedPoints: null, reliabilityPercent: null, points: [] }));

  assert.equal(charts.length, 0);
  assert.match(slides[4] ?? "", /No closed sprints yet\./);
});

test("buildSprintReviewPptxFileName matches the HTML export name", () => {
  assert.equal(buildSprintReviewPptxFileName("2026-10-16"), "Sprint review 2026-10-16.pptx");
});

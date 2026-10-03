import assert from "node:assert/strict";
import test from "node:test";
import { buildSprintReviewDocument, countWorkingDays } from "./document";
import { buildSummaryLines, toCommandSummary } from "./formatters";
import { buildTeamVelocitySeries } from "../jira/sprint-report";
import type { JiraSprintReviewIssue, JiraSprintReviewSnapshot, TeamVelocitySeries } from "../jira/types";

const OPTIONS = {
  includeAddedDuringSprint: true,
  cancelledStatuses: ["Cancelled"],
  almostDoneStatuses: ["In Review", "To Merge"],
  // Wednesday 2026-10-14; the sprint ends Friday 2026-10-16.
  now: new Date("2026-10-14T10:00:00.000Z"),
};

function issue(
  key: string,
  status: string,
  estimate: number | null,
  statusCategory: JiraSprintReviewIssue["statusCategory"] = "indeterminate"
): JiraSprintReviewIssue {
  return { key, summary: `${key} summary`, status, issueType: "Story", priority: "Major", estimate, statusCategory };
}

const VELOCITY: TeamVelocitySeries = {
  boardId: "2",
  windowSize: 3,
  includeAddedDuringSprint: true,
  averageCompletedPoints: 31,
  averageCommittedPoints: 59.6,
  reliabilityPercent: 52,
  points: [],
};

function snapshot(overrides: Partial<JiraSprintReviewSnapshot> = {}): JiraSprintReviewSnapshot {
  return {
    projectKey: "PROJ",
    boardId: "2",
    board: { id: "2", self: null, name: "Test Board", type: "scrum", projectKey: "PROJ", projectName: "Test", projectType: "software" },
    sprint: {
      id: "1",
      self: null,
      name: "Sprint 7",
      state: "ACTIVE",
      startDate: "2026-10-05T09:00:00.000Z",
      endDate: "2026-10-16T17:00:00.000Z",
      completeDate: null,
      activatedDate: null,
      goal: "- Ship Payments-V2\n- Search revamp",
      originBoardId: "2",
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
    completedIssues: [
      issue("PROJ-1", "Done", 5, "done"),
      issue("PROJ-2", "Done", 3, "done"),
      issue("PROJ-3", "Cancelled", 8, "done"),
      issue("PROJ-10", "Done", 0, "done"),
    ],
    notCompletedIssues: [
      issue("PROJ-4", "In Review", 5),
      issue("PROJ-5", "In Progress", 3),
      issue("PROJ-6", "To Do", null, "new"),
      issue("PROJ-7", "To Do", 2, "new"),
      issue("PROJ-11", "In Progress", 0),
    ],
    puntedIssues: [],
    completedInAnotherSprintIssues: [],
    issueKeysAddedDuringSprint: [],
    issueKeysRemovedDuringSprint: [],
    ...overrides,
  };
}

test("countWorkingDays skips weekends and counts the end day", () => {
  // Wed 14 → Fri 16: Thu + Fri.
  assert.equal(countWorkingDays(new Date("2026-10-14T10:00:00Z"), new Date("2026-10-16T17:00:00Z")), 2);
  // Fri 16 → Mon 19: only Monday.
  assert.equal(countWorkingDays(new Date("2026-10-16T10:00:00Z"), new Date("2026-10-19T09:00:00Z")), 1);
  assert.equal(countWorkingDays(new Date("2026-10-20T10:00:00Z"), new Date("2026-10-16T09:00:00Z")), 0);
});

test("goal slide counts child tickets only and excludes cancelled tickets", () => {
  const document = buildSprintReviewDocument(snapshot(), VELOCITY, OPTIONS);

  // PROJ-10 and PROJ-11 are parents (0 points); PROJ-3 is cancelled.
  assert.equal(document.goal.ticketsDone, 2);
  assert.equal(document.goal.ticketsTotal, 6);
  assert.equal(document.goal.cancelledCount, 1);
  assert.equal(document.goal.pointsDone, 8);
  assert.equal(document.goal.pointsCommitted, 18);
  assert.equal(document.goal.pointsPercent, 44.4);
  assert.equal(document.goal.daysLeft, 2);
  assert.deepEqual(document.header.sprint.goals, ["Ship Payments-V2", "Search revamp"]);
});

test("goal status is achieved, partially achieved or missed", () => {
  // 44.4% of points done → missed, whatever the date.
  const document = buildSprintReviewDocument(snapshot(), VELOCITY, OPTIONS);
  assert.equal(document.goal.status, "missed");
  assert.deepEqual(
    document.goal.goals.map((goal) => goal.status),
    ["not_achieved", "not_achieved"]
  );

  const half = buildSprintReviewDocument(
    snapshot({ completedIssues: [issue("PROJ-1", "Done", 9, "done")], notCompletedIssues: [issue("PROJ-2", "To Do", 9, "new")] }),
    VELOCITY,
    OPTIONS
  );
  assert.equal(half.goal.status, "partial");
  assert.deepEqual(
    half.goal.goals.map((goal) => goal.status),
    ["unclear", "unclear"]
  );

  const done = buildSprintReviewDocument(
    snapshot({ completedIssues: [issue("PROJ-1", "Done", 5, "done")], notCompletedIssues: [] }),
    VELOCITY,
    OPTIONS
  );
  assert.equal(done.goal.status, "achieved");

  const closed = buildSprintReviewDocument(
    snapshot({ sprint: { ...snapshot().sprint, state: "CLOSED", completeDate: "2026-10-16T17:00:00Z" } }),
    VELOCITY,
    OPTIONS
  );
  assert.equal(closed.goal.status, "missed");
  assert.equal(closed.goal.daysLeft, null);
});

test("delivered slide compares points with the team average", () => {
  const document = buildSprintReviewDocument(snapshot(), VELOCITY, OPTIONS);

  assert.equal(document.delivered.tickets, 2);
  assert.equal(document.delivered.points, 8);
  assert.equal(document.delivered.deltaVsAverage, -23);
  assert.deepEqual(
    document.delivered.issues.map((item) => item.key),
    ["PROJ-1", "PROJ-2"]
  );
  assert.equal(buildSummaryLines(document).deliveredDelta, "−23 vs the 31 average");
});

test("slipped slide buckets open tickets so they add up", () => {
  const document = buildSprintReviewDocument(snapshot(), VELOCITY, OPTIONS);

  assert.equal(document.slipped.remainingPoints, 10);
  assert.equal(document.slipped.almostDone, 1);
  assert.equal(document.slipped.inProgress, 1);
  assert.equal(document.slipped.notStarted, 2);
  assert.equal(document.slipped.unestimated, 1);
  assert.equal(
    document.slipped.almostDone + document.slipped.inProgress + document.slipped.notStarted,
    document.goal.ticketsTotal - document.goal.ticketsDone
  );
});

test("team reliability is total completed over total committed", () => {
  const sprintSnapshot = (completed: number, open: number): JiraSprintReviewSnapshot =>
    snapshot({
      completedIssues: [issue("PROJ-1", "Done", completed, "done")],
      notCompletedIssues: open > 0 ? [issue("PROJ-2", "To Do", open, "new")] : [],
    });

  // 10/10, 20/80, 28/40: average of percentages is 65%, total ÷ total is 58/130.
  const series = buildTeamVelocitySeries("2", 3, true, [sprintSnapshot(10, 0), sprintSnapshot(20, 60), sprintSnapshot(28, 12)]);

  assert.equal(series.reliabilityPercent, 44.6);
  assert.deepEqual(
    series.points.map((point) => point.reliabilityPercent),
    [100, 25, 70]
  );
});

test("CLI summary follows the slides", () => {
  const summary = toCommandSummary(buildSprintReviewDocument(snapshot(), VELOCITY, OPTIONS));

  assert.match(summary, /^Goal — Missed$/m);
  assert.match(summary, /^Tickets done: 2 \/ 6 \(\+1 cancelled\)$/m);
  assert.match(summary, /^Points delivered: 8 \/ 18 \(44\.4%\) · average 52%$/m);
  assert.match(summary, /^Almost done: 1 · In progress: 1 · Not started: 2 · Unestimated: 1$/m);
  assert.match(summary, /^- PROJ-4 — PROJ-4 summary \(Story, In Review, Major\) · 5 pts$/m);
  assert.match(summary, /^Reliability: 52% \(this sprint 44\.4%\)$/m);
});

test("slipped buckets work when Jira returns no status category (Data Center)", () => {
  const dataCenterSnapshot = snapshot({
    completedIssues: [issue("PROJ-1", "Done", 5, null)],
    notCompletedIssues: [
      issue("PROJ-20", "To Review", 5, null),
      issue("PROJ-21", "To deploy in UAT", 5, null),
      issue("PROJ-22", "In Progress", 3, null),
      issue("PROJ-23", "To Do", 3, null),
      issue("PROJ-24", "To Do", 2, null),
      issue("PROJ-25", "To Do", 1, null),
    ],
  });

  const document = buildSprintReviewDocument(dataCenterSnapshot, VELOCITY, {
    ...OPTIONS,
    // Written the way .env values often are: quotes stripped upstream, uneven spaces left.
    almostDoneStatuses: [" to review", "To  deploy in UAT "],
    notStartedStatuses: ["To Do", "Open", "Backlog"],
  });

  assert.equal(document.slipped.almostDone, 2);
  assert.equal(document.slipped.inProgress, 1);
  assert.equal(document.slipped.notStarted, 3);
  assert.deepEqual(document.slipped.almostDoneStatuses, [" to review", "To  deploy in UAT "]);
});

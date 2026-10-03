import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAssessment,
  assessmentCacheKey,
  assessSprint,
  buildAssessmentPrompt,
  extractTicketThemes,
  matchGoalsByTheme,
  parseAssessment,
} from "./assessment";
import { buildSprintReviewDocument, type SprintReviewDocument } from "./document";
import type { JiraSprintReviewIssue, JiraSprintReviewSnapshot, TeamVelocitySeries } from "../jira/types";

function issue(key: string, summary: string, status: string, estimate: number, category: JiraSprintReviewIssue["statusCategory"]): JiraSprintReviewIssue {
  return { key, summary, status, issueType: "Story", priority: "Major", estimate, statusCategory: category };
}

const VELOCITY: TeamVelocitySeries = {
  boardId: "42",
  windowSize: 3,
  includeAddedDuringSprint: true,
  averageCompletedPoints: null,
  averageCommittedPoints: null,
  reliabilityPercent: null,
  points: [],
};

function makeDocument(overrides: Partial<JiraSprintReviewSnapshot> = {}): SprintReviewDocument {
  const snapshot: JiraSprintReviewSnapshot = {
    projectKey: "PROJ",
    boardId: "42",
    board: { id: "42", self: null, name: "Test Board", type: "scrum", projectKey: "PROJ", projectName: "Test", projectType: "software" },
    sprint: {
      id: "7",
      self: null,
      name: "Sprint 7",
      state: "active",
      startDate: "2026-10-05T09:00:00.000Z",
      endDate: "2026-10-16T17:00:00.000Z",
      completeDate: null,
      activatedDate: null,
      goal: "- Finish infra migration\n- Ship login page",
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
    completedIssues: [issue("PROJ-1", "Migrate infra pipelines", "Done", 5, "done")],
    notCompletedIssues: [issue("PROJ-2", "Login page UI", "In Progress", 3, "indeterminate")],
    puntedIssues: [],
    completedInAnotherSprintIssues: [],
    issueKeysAddedDuringSprint: [],
    issueKeysRemovedDuringSprint: [],
    ...overrides,
  };
  return buildSprintReviewDocument(snapshot, VELOCITY, {
    includeAddedDuringSprint: true,
    cancelledStatuses: [],
    almostDoneStatuses: [],
    now: new Date("2026-10-14T10:00:00Z"),
  });
}

const ANSWER = {
  summary: "Infra migration landed; the login page carries over.",
  goals: [
    { goal: "finish  infra migration", status: "achieved", confidence: "high", evidence: ["proj-1"], rationale: "PROJ-1 is done." },
    { goal: "Ship login page", status: "not_achieved", confidence: "high", evidence: ["PROJ-404"], rationale: "Only an unknown ticket." },
    { goal: "A goal that does not exist", status: "achieved", confidence: "high", evidence: [], rationale: "Made up." },
  ],
};

function sprintPayload(user: string) {
  const match = user.match(/<sprint>\n([\s\S]*?)\n<\/sprint>/);
  assert.ok(match, "user prompt wraps the data in <sprint>");
  return JSON.parse(match[1] ?? "");
}

test("buildAssessmentPrompt sends goals, facts and tickets but no Jira connection details", () => {
  const { system, user } = buildAssessmentPrompt(makeDocument());
  const payload = sprintPayload(user);

  for (const tag of ["verdict_tiers", "rules", "output_format"]) {
    assert.match(system, new RegExp(`<${tag}>[\\s\\S]+</${tag}>`));
  }
  assert.match(system, /no markdown fences, no extra text, no extra fields/);
  assert.doesNotMatch(system, /<team_rules>/);
  assert.deepEqual(payload.goals, ["Finish infra migration", "Ship login page"]);
  assert.deepEqual(
    payload.tickets.map((ticket: { key: string; stage: string }) => `${ticket.key}:${ticket.stage}`),
    ["PROJ-1:done", "PROJ-2:in progress"]
  );
  assert.equal(payload.facts.pointsDone, 5);
  assert.doesNotMatch(user, /https?:|token|Authorization/i);
});

test("parseAssessment matches goals loosely, drops unknown goals and made-up ticket keys", () => {
  const assessment = parseAssessment(JSON.stringify(ANSWER), makeDocument(), "m");

  assert.ok(assessment);
  assert.deepEqual(
    assessment.goals.map((goal) => [goal.goal, goal.status, goal.confidence, goal.evidence]),
    [
      ["Finish infra migration", "achieved", "high", ["PROJ-1"]],
      // No valid evidence left, so confidence drops to low.
      ["Ship login page", "not_achieved", "low", []],
    ]
  );
});

test("parseAssessment accepts a fenced JSON answer and rejects malformed ones", () => {
  const document = makeDocument();
  assert.ok(parseAssessment("Here you go:\n```json\n" + JSON.stringify(ANSWER) + "\n```", document, "m"));
  assert.equal(parseAssessment("no json here", document, "m"), null);
  assert.equal(parseAssessment(JSON.stringify({ summary: "x", goals: [{ goal: "Ship login page", status: "done" }] }), document, "m"), null);
});

test("applyAssessment sets per-goal verdicts and keeps the rule-based overall status", () => {
  const document = makeDocument();
  const assessment = parseAssessment(JSON.stringify(ANSWER), document, "m");
  assert.ok(assessment);

  const assessed = applyAssessment(document, assessment);

  assert.equal(assessed.goal.status, document.goal.status);
  assert.deepEqual(
    assessed.goal.goals.map((goal) => [goal.text, goal.status, goal.source]),
    [
      ["Finish infra migration", "achieved", "llm"],
      ["Ship login page", "not_achieved", "llm"],
    ]
  );
  assert.equal(assessed.assessment?.summary, ANSWER.summary);
});

test("assessSprint never throws: model errors and empty goals become a reason", async () => {
  const failing = await assessSprint(makeDocument(), async () => {
    throw new Error("rate limited");
  }, "m");
  assert.deepEqual(failing, { assessment: null, error: "rate limited" });

  const noGoals = await assessSprint(makeDocument({ sprint: { ...makeDocument().header.sprint, goal: null } as never }), async () => "{}", "m");
  assert.equal(noGoals.assessment, null);
});

test("assessmentCacheKey changes when the tickets change", () => {
  const before = assessmentCacheKey(makeDocument());
  assert.equal(before, assessmentCacheKey(makeDocument()));
  const after = assessmentCacheKey(
    makeDocument({ notCompletedIssues: [issue("PROJ-2", "Login page UI", "In Review", 3, "indeterminate")] })
  );
  assert.notEqual(before, after);
});

test("extractTicketThemes reads the leading bracketed themes", () => {
  assert.deepEqual(extractTicketThemes("[Payments v2][Front] validate workflows"), ["Payments v2", "Front"]);
  assert.deepEqual(extractTicketThemes("  [Search] remove routes [not a theme]"), ["Search"]);
  assert.deepEqual(extractTicketThemes("Write docs"), []);
});

test("matchGoalsByTheme ignores case, spaces, punctuation and very short themes", () => {
  const goals = ["Ship Payments-V2", "Search revamp"];
  assert.deepEqual(matchGoalsByTheme("[Payments v2][Front] validate workflows", goals), ["Ship Payments-V2"]);
  assert.deepEqual(matchGoalsByTheme("[SEARCH] remove legacy routes", goals), ["Search revamp"]);
  assert.deepEqual(matchGoalsByTheme("[UI] tweak", ["UI polish"]), []);
  assert.deepEqual(matchGoalsByTheme("Write docs", goals), []);
});

test("buildAssessmentPrompt tags tickets with their matched goal and lists data gaps", () => {
  const document = makeDocument({
    completedIssues: [issue("PROJ-1", "[Infra migration][Back] move pipelines", "Done", 5, "done")],
    notCompletedIssues: [{ ...issue("PROJ-2", "Write docs", "To Do", 1, "new"), estimate: null }],
  });
  const { user } = buildAssessmentPrompt(document);
  const tickets = sprintPayload(user).tickets;

  assert.deepEqual(tickets[0].matchedGoals, ["Finish infra migration"]);
  assert.equal(tickets[1].matchedGoals, undefined);
  assert.match(user, /<data_gaps>[\s\S]*No estimate on: PROJ-2[\s\S]*No bracketed theme matching a goal on: PROJ-2[\s\S]*<\/data_gaps>/);
});

test("team rules are added to the system prompt and change the cache key", () => {
  const document = makeDocument();
  const teamRules = "A goal is achieved only once its tickets are deployed in UAT.";
  const { system } = buildAssessmentPrompt(document, { teamRules });

  assert.match(system, /<team_rules>\nA goal is achieved only once its tickets are deployed in UAT\.\n<\/team_rules>/);
  assert.notEqual(assessmentCacheKey(document), assessmentCacheKey(document, { teamRules }));
});

test("parseAssessment records whether team rules were part of the prompt", () => {
  const document = makeDocument();
  assert.equal(parseAssessment(JSON.stringify(ANSWER), document, "m")?.teamRules, false);
  assert.equal(parseAssessment(JSON.stringify(ANSWER), document, "m", { teamRules: "Done means PROD." })?.teamRules, true);
});

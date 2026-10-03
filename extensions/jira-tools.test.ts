import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { piLlmProvider, registerJiraCommands, registerJiraTools, type LlmProvider } from "./jira-tools";
import type { JiraClient, JiraSprintReviewSnapshot, TeamVelocitySeries } from "../src/jira/client";
import { buildSprintReviewDocument, type SprintReviewDocument } from "../src/sprint-review/document";
import { toCommandSummary } from "../src/sprint-review/formatters";

const TEST_PROJECT_KEY = "PROJ";
const TEST_BOARD_ID = 42;
const TEST_BOARD_ID_TEXT = "42";
const TEST_SPRINT_NAME = "Sprint 12";
const TEST_BOARD_NAME = "Test Board";
const TEST_SPRINT_REVIEW_TOOL = "jiraGetSprintReview";
const TEST_SPRINT_REVIEW_TITLE = `Sprint review snapshot for ${TEST_PROJECT_KEY} board ${TEST_BOARD_ID_TEXT}`;
const TEST_FAILURE_MESSAGE = `No active sprint found for board ${TEST_BOARD_ID_TEXT}.`;
const TEST_TEAM_VELOCITY_SERIES: TeamVelocitySeries = {
  boardId: TEST_BOARD_ID_TEXT,
  windowSize: 2,
  includeAddedDuringSprint: false,
  averageCompletedPoints: 5.5,
  averageCommittedPoints: 6.5,
  reliabilityPercent: 84.6,
  points: [
    {
      sprintId: "269001",
      sprintName: "Sprint 1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-07-14T00:00:00.000Z",
      completedPoints: 3,
      committedPoints: 5,
      reliabilityPercent: 60,
      includeAddedDuringSprint: false,
    },
    {
      sprintId: "269002",
      sprintName: "Sprint 2",
      startDate: "2026-07-15T00:00:00.000Z",
      endDate: "2026-07-28T00:00:00.000Z",
      completedPoints: 8,
      committedPoints: 8,
      reliabilityPercent: 100,
      includeAddedDuringSprint: false,
    },
  ],
};

const TEST_SPRINT_REVIEW_SNAPSHOT: JiraSprintReviewSnapshot = {
  projectKey: TEST_PROJECT_KEY,
  boardId: TEST_BOARD_ID_TEXT,
  board: {
    id: TEST_BOARD_ID_TEXT,
    self: "https://jira.example.com/rest/agile/1.0/board/42",
    name: TEST_BOARD_NAME,
    type: "scrum",
    projectKey: TEST_PROJECT_KEY,
    projectName: TEST_BOARD_NAME,
    projectType: "project",
  },
  sprint: {
    id: "269035",
    self: "https://jira.example.com/rest/agile/1.0/sprint/269035",
    name: TEST_SPRINT_NAME,
    state: "active",
    startDate: "2026-09-23T13:38:00.000Z",
    endDate: "2026-10-06T15:07:00.000Z",
    completeDate: null,
    activatedDate: "2026-09-23T13:43:42.832Z",
    goal: "- Ship Payments-V2",
    originBoardId: TEST_BOARD_ID_TEXT,
  },
  metrics: {
    completedIssueCount: 1,
    notCompletedIssueCount: 1,
    puntedIssueCount: 0,
    completedInAnotherSprintIssueCount: 0,
    totalIssueCount: 2,
    addedDuringSprintCount: 1,
    removedDuringSprintCount: 0,
    statusCounts: {
      Done: 1,
      "In Progress": 1,
    },
    estimateStatistics: {
      statFieldId: "customfield_10016",
      sum: 13,
      completedSum: 8,
    },
  },
  completedIssues: [
    {
      key: "PROJ-1",
      summary: "Done item",
      status: "Done",
      issueType: "Task",
      priority: "Major",
      estimate: 8,
      statusCategory: null,
    },
  ],
  notCompletedIssues: [
    {
      key: "PROJ-2",
      summary: "In progress item",
      status: "In Progress",
      issueType: "Story",
      priority: "High",
      estimate: 5,
      statusCategory: null,
    },
  ],
  puntedIssues: [],
  completedInAnotherSprintIssues: [],
  issueKeysAddedDuringSprint: ["PROJ-2"],
  issueKeysRemovedDuringSprint: [],
};

type RegisteredTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: { projectKey: string; boardId?: string | number },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: unknown
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean; details?: unknown } | { content: Array<{ type: string; text: string }>; isError: true; details?: unknown }>;
};

type RegisteredCommand = {
  name: string;
  description: string;
  handler: (
    args: string,
    ctx: {
      ui: { notify: (message: string, level: string) => void; setStatus?: (key: string, text: string | undefined) => void };
      sessionManager?: { getEntries(): readonly unknown[] };
    }
  ) => Promise<void> | void;
};

type AppendedEntry = {
  customType: string;
  data: unknown;
};

function createFakePi(registeredTools: RegisteredTool[], registeredCommands: RegisteredCommand[], appendedEntries: AppendedEntry[]): ExtensionAPI {
  return {
    registerTool(tool: RegisteredTool) {
      registeredTools.push(tool);
    },
    registerCommand(name: string, options: RegisteredCommand) {
      registeredCommands.push({ name, description: options.description, handler: options.handler });
    },
    appendEntry(customType: string, data?: unknown) {
      appendedEntries.push({ customType, data });
    },
  } as unknown as ExtensionAPI;
}

test("registerJiraTools registers the sprint review tool and returns sprint review data", async () => {
  const registeredTools: RegisteredTool[] = [];
  const fakeClient: Pick<JiraClient, "getSprintReviewSnapshot"> = {
    async getSprintReviewSnapshot(projectKey, boardId) {
      assert.equal(projectKey, TEST_PROJECT_KEY);
      assert.equal(boardId, TEST_BOARD_ID);
      return TEST_SPRINT_REVIEW_SNAPSHOT;
    },
  };

  registerJiraTools(createFakePi(registeredTools, [], []), () => fakeClient as unknown as JiraClient);

  const toolNames = registeredTools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "jiraCreateIssue",
    "jiraUpdateIssue",
    "jiraGetIssue",
    "jiraAddComment",
    TEST_SPRINT_REVIEW_TOOL,
  ]);

  const sprintReviewTool = registeredTools.find((tool) => tool.name === TEST_SPRINT_REVIEW_TOOL);
  if (!sprintReviewTool) {
    throw new Error(`Missing tool ${TEST_SPRINT_REVIEW_TOOL}`);
  }
  assert.match(sprintReviewTool.description, /sprint review data/i);

  const result = await sprintReviewTool.execute(
    "tool-call-1",
    { projectKey: TEST_PROJECT_KEY, boardId: TEST_BOARD_ID },
    undefined,
    undefined,
    undefined
  );

  assert.equal(result.isError, undefined);
  assert.equal(result.content[0]?.text, `${TEST_SPRINT_REVIEW_TITLE}\n${JSON.stringify(TEST_SPRINT_REVIEW_SNAPSHOT, null, 2)}`);
  assert.deepEqual(result.details, TEST_SPRINT_REVIEW_SNAPSHOT);
});

test("registerJiraTools allows the sprint review board id to be omitted", async () => {
  const registeredTools: RegisteredTool[] = [];
  const fakeClient: Pick<JiraClient, "getSprintReviewSnapshot"> = {
    async getSprintReviewSnapshot(projectKey, boardId) {
      assert.equal(projectKey, TEST_PROJECT_KEY);
      assert.equal(boardId, undefined);
      return TEST_SPRINT_REVIEW_SNAPSHOT;
    },
  };

  registerJiraTools(createFakePi(registeredTools, [], []), () => fakeClient as unknown as JiraClient);

  const sprintReviewTool = registeredTools.find((tool) => tool.name === TEST_SPRINT_REVIEW_TOOL);
  if (!sprintReviewTool) {
    throw new Error(`Missing tool ${TEST_SPRINT_REVIEW_TOOL}`);
  }

  const result = await sprintReviewTool.execute(
    "tool-call-2",
    { projectKey: TEST_PROJECT_KEY },
    undefined,
    undefined,
    undefined
  );

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details, TEST_SPRINT_REVIEW_SNAPSHOT);
});

test("registerJiraTools surfaces sprint review failures as tool errors", async () => {
  const registeredTools: RegisteredTool[] = [];
  const fakeClient: Pick<JiraClient, "getSprintReviewSnapshot"> = {
    async getSprintReviewSnapshot() {
      throw new Error(TEST_FAILURE_MESSAGE);
    },
  };

  registerJiraTools(createFakePi(registeredTools, [], []), () => fakeClient as unknown as JiraClient);

  const sprintReviewTool = registeredTools.find((tool) => tool.name === TEST_SPRINT_REVIEW_TOOL);
  if (!sprintReviewTool) {
    throw new Error(`Missing tool ${TEST_SPRINT_REVIEW_TOOL}`);
  }

  const result = await sprintReviewTool.execute(
    "tool-call-2",
    { projectKey: TEST_PROJECT_KEY, boardId: TEST_BOARD_ID_TEXT },
    undefined,
    undefined,
    undefined
  );

  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.text, `${TEST_SPRINT_REVIEW_TOOL} failed\n${TEST_FAILURE_MESSAGE}`);
  assert.deepEqual(result.details, { message: TEST_FAILURE_MESSAGE });
});


const TEST_COMMAND_CONFIG = {
  projectKey: TEST_PROJECT_KEY,
  boardId: TEST_BOARD_ID_TEXT,
  cancelledStatuses: ["Cancelled"],
  almostDoneStatuses: ["In Review"],
};

type NotifyCall = { message: string; level: string };

type RunOptions = {
  getLlm?: LlmProvider;
  sessionEntries?: unknown[];
  statusCalls?: Array<string | undefined>;
  failSnapshot?: boolean;
};

const TEST_MODEL = "test-model";
const TEST_LLM_ANSWER = JSON.stringify({
  summary: "Delivered the done item; the in-progress story carries over.",
  goals: [
    {
      goal: "Ship Payments-V2",
      status: "partial",
      confidence: "medium",
      evidence: ["PROJ-1", "PROJ-999"],
      rationale: "One related ticket is done, the other is still in progress.",
    },
  ],
});

function fakeLlm(answer: string, calls: string[] = []): LlmProvider {
  return async () => ({
    model: TEST_MODEL,
    complete: async ({ user }) => {
      calls.push(user);
      return answer;
    },
  });
}

async function runSprintReviewCommand(
  args: string,
  snapshot: JiraSprintReviewSnapshot,
  expectedIncludeAdded: boolean,
  options: RunOptions = {}
): Promise<{ appendedEntries: AppendedEntry[]; notifyCalls: NotifyCall[]; commandNames: string[] }> {
  const registeredCommands: RegisteredCommand[] = [];
  const appendedEntries: AppendedEntry[] = [];
  const notifyCalls: NotifyCall[] = [];
  const fakeClient: Pick<JiraClient, "getSprintReviewSnapshot" | "getTeamVelocity"> = {
    async getSprintReviewSnapshot(projectKey, boardId) {
      assert.equal(projectKey, TEST_PROJECT_KEY);
      assert.equal(boardId, TEST_BOARD_ID_TEXT);
      if (options.failSnapshot) {
        throw new Error("Jira is down");
      }
      return snapshot;
    },
    async getTeamVelocity(projectKey, boardId, windowSize, includeAddedDuringSprint) {
      assert.equal(projectKey, TEST_PROJECT_KEY);
      assert.equal(boardId, TEST_BOARD_ID_TEXT);
      assert.equal(windowSize, 5);
      assert.equal(includeAddedDuringSprint, expectedIncludeAdded);
      return TEST_TEAM_VELOCITY_SERIES;
    },
  };

  registerJiraCommands(
    createFakePi([], registeredCommands, appendedEntries),
    () => fakeClient as unknown as JiraClient,
    () => TEST_COMMAND_CONFIG,
    options.getLlm ?? (async () => ({ error: "no model in tests" }))
  );

  const sprintReviewCommand = registeredCommands[0];
  if (!sprintReviewCommand) {
    throw new Error("Missing sprintReview command");
  }

  await sprintReviewCommand.handler(args, {
    ui: {
      notify(message: string, level: string) {
        notifyCalls.push({ message, level });
      },
      setStatus(_key: string, text: string | undefined) {
        options.statusCalls?.push(text);
      },
    },
    sessionManager: { getEntries: () => options.sessionEntries ?? [] },
  });

  return { appendedEntries, notifyCalls, commandNames: registeredCommands.map((command) => command.name) };
}

function expectedDocument(snapshot: JiraSprintReviewSnapshot, includeAddedDuringSprint: boolean) {
  return buildSprintReviewDocument(snapshot, TEST_TEAM_VELOCITY_SERIES, {
    includeAddedDuringSprint,
    cancelledStatuses: TEST_COMMAND_CONFIG.cancelledStatuses,
    almostDoneStatuses: TEST_COMMAND_CONFIG.almostDoneStatuses,
  });
}

test("registerJiraCommands registers sprintReview and shares one document between the entry and the CLI summary", async () => {
  const { appendedEntries, notifyCalls, commandNames } = await runSprintReviewCommand("", TEST_SPRINT_REVIEW_SNAPSHOT, false);
  const document = expectedDocument(TEST_SPRINT_REVIEW_SNAPSHOT, false);

  assert.deepEqual(commandNames, ["sprintReview"]);
  assert.deepEqual(appendedEntries, [{ customType: "jira-sprint-review", data: document }]);
  assert.deepEqual(notifyCalls, [{ message: toCommandSummary(document), level: "info" }]);

  const summary = notifyCalls[0]?.message ?? "";
  assert.match(summary, /^Sprint Review — PROJ \/ Board 42/m);
  assert.match(summary, /^Tickets done: 1 \/ 2 \(\+0 cancelled\)$/m);
  assert.match(summary, /^Points delivered: 8 \/ 8 \(100%\) · average 84\.6%$/m);
  assert.match(summary, /^Estimate basis: excludes added issues/m);
});

test("registerJiraCommands includes added sprint issues when the flag is set", async () => {
  const { appendedEntries, notifyCalls } = await runSprintReviewCommand("--includeAddedDuringSprint", TEST_SPRINT_REVIEW_SNAPSHOT, true);
  const document = expectedDocument(TEST_SPRINT_REVIEW_SNAPSHOT, true);

  assert.deepEqual(appendedEntries, [{ customType: "jira-sprint-review", data: document }]);
  assert.match(notifyCalls[0]?.message ?? "", /^Points delivered: 8 \/ 13 \(61\.5%\) · average 84\.6%$/m);
  assert.match(notifyCalls[0]?.message ?? "", /^Estimate basis: includes added issues$/m);
});

test("registerJiraCommands exports sprint review html when requested", async () => {
  const originalCwd = process.cwd();
  const exportDir = mkdtempSync(join(tmpdir(), "jira-tools-export-"));
  process.chdir(exportDir);

  try {
    const { appendedEntries, notifyCalls } = await runSprintReviewCommand("--html --no-assess", TEST_SPRINT_REVIEW_SNAPSHOT, false);

    const exportFileName = "Sprint review 2026-10-06.html";
    const html = readFileSync(join(exportDir, ".pi", "sprintReviewReports", exportFileName), "utf8");

    assert.match(html, /Sprint review/i);
    assert.match(html, /Sprint 12/);
    assert.match(html, /Test Board/);
    assert.match(html, /<div class="cover-art" aria-hidden="true"><svg /);
    assert.match(html, /Ship Payments-V2/);
    assert.match(html, /PROJ-1/);
    assert.match(html, /PROJ-2/);
    assert.doesNotMatch(html, /{{/);
    assert.deepEqual(appendedEntries, [{ customType: "jira-sprint-review", data: expectedDocument(TEST_SPRINT_REVIEW_SNAPSHOT, false) }]);
    assert.deepEqual(notifyCalls, [{ message: `Exported report to ${exportFileName}`, level: "info" }]);
  } finally {
    process.chdir(originalCwd);
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("registerJiraCommands --html runs the LLM assessment by default and renders it", async () => {
  const originalCwd = process.cwd();
  const exportDir = mkdtempSync(join(tmpdir(), "jira-tools-export-"));
  process.chdir(exportDir);

  try {
    const calls: string[] = [];
    const { appendedEntries, notifyCalls } = await runSprintReviewCommand("--html", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
      getLlm: fakeLlm(TEST_LLM_ANSWER, calls),
    });
    const html = readFileSync(join(exportDir, ".pi", "sprintReviewReports", "Sprint review 2026-10-06.html"), "utf8");

    assert.equal(calls.length, 1);
    assert.match(html, /Summary · assessed by test-model/);
    assert.match(html, /Delivered the done item/);
    assert.match(html, /One related ticket is done/);
    assert.match(html, /class="notes"/);
    assert.deepEqual(
      appendedEntries.map((entry) => entry.customType),
      ["jira-sprint-review-assessment", "jira-sprint-review"]
    );
    const document = appendedEntries[1]?.data as SprintReviewDocument;
    assert.equal(document.assessment?.model, TEST_MODEL);
    // The made-up PROJ-999 is dropped; the overall status stays the points rule.
    assert.deepEqual(document.goal.goals[0]?.evidence, ["PROJ-1"]);
    assert.equal(document.goal.status, expectedDocument(TEST_SPRINT_REVIEW_SNAPSHOT, false).goal.status);
    assert.deepEqual(notifyCalls.map((call) => call.level), ["info"]);
  } finally {
    process.chdir(originalCwd);
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("registerJiraCommands --assess adds the LLM verdicts to the CLI summary", async () => {
  const { notifyCalls } = await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
    getLlm: fakeLlm(TEST_LLM_ANSWER),
  });
  const summary = notifyCalls[0]?.message ?? "";

  assert.match(summary, /^Summary \(test-model\): Delivered the done item/m);
  assert.match(summary, /^- Ship Payments-V2: partially achieved \(medium confidence\) · PROJ-1 — One related ticket is done/m);
});

test("registerJiraCommands reuses a cached assessment instead of calling the model again", async () => {
  const first = await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, { getLlm: fakeLlm(TEST_LLM_ANSWER) });
  const cachedEntry = first.appendedEntries.find((entry) => entry.customType === "jira-sprint-review-assessment");
  const calls: string[] = [];

  const second = await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
    getLlm: fakeLlm(TEST_LLM_ANSWER, calls),
    sessionEntries: [{ type: "custom", customType: cachedEntry?.customType, data: cachedEntry?.data }],
  });

  assert.equal(calls.length, 0);
  assert.match(second.notifyCalls[0]?.message ?? "", /^Summary \(test-model\)/m);
});

test("registerJiraCommands still reports when the LLM fails", async () => {
  const { notifyCalls, appendedEntries } = await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
    getLlm: fakeLlm("not json at all"),
  });

  assert.deepEqual(
    notifyCalls.map((call) => call.level),
    ["warning", "info"]
  );
  assert.match(notifyCalls[0]?.message ?? "", /LLM goal assessment skipped/);
  assert.equal((appendedEntries[0]?.data as SprintReviewDocument).assessment, null);
});

test("registerJiraCommands shows each step in the footer status and clears it", async () => {
  const statusCalls: Array<string | undefined> = [];
  await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, { getLlm: fakeLlm(TEST_LLM_ANSWER), statusCalls });

  const steps = statusCalls.map((text) => text?.replace(/^\S+ /, ""));
  assert.ok(steps.includes("Sprint review · fetching sprint from Jira…"));
  assert.ok(steps.includes("Sprint review · assessing goals with test-model…"));
  assert.equal(statusCalls.at(-1), undefined);
});

test("registerJiraCommands clears the footer status when Jira fails", async () => {
  const statusCalls: Array<string | undefined> = [];
  await assert.rejects(runSprintReviewCommand("", TEST_SPRINT_REVIEW_SNAPSHOT, false, { statusCalls, failSnapshot: true }), /Jira is down/);
  assert.equal(statusCalls.at(-1), undefined);
});

test("registerJiraCommands --html --pptx writes both decks with one LLM call", async () => {
  const originalCwd = process.cwd();
  const exportDir = mkdtempSync(join(tmpdir(), "jira-tools-pptx-"));
  process.chdir(exportDir);

  try {
    const calls: string[] = [];
    const statusCalls: Array<string | undefined> = [];
    const { notifyCalls } = await runSprintReviewCommand("--html --pptx", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
      getLlm: fakeLlm(TEST_LLM_ANSWER, calls),
      statusCalls,
    });
    const reports = join(exportDir, ".pi", "sprintReviewReports");

    assert.equal(calls.length, 1);
    assert.ok(readFileSync(join(reports, "Sprint review 2026-10-06.html"), "utf8").includes("Sprint review"));
    assert.equal(readFileSync(join(reports, "Sprint review 2026-10-06.pptx")).subarray(0, 2).toString(), "PK");
    assert.ok(statusCalls.some((text) => text?.endsWith("writing PowerPoint deck…")));
    assert.deepEqual(notifyCalls, [
      { message: "Exported reports to Sprint review 2026-10-06.html and Sprint review 2026-10-06.pptx", level: "info" },
    ]);
  } finally {
    process.chdir(originalCwd);
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("registerJiraCommands shows when the team rules file is used", async () => {
  const originalCwd = process.cwd();
  const projectDir = mkdtempSync(join(tmpdir(), "jira-tools-rules-"));
  mkdirSync(join(projectDir, ".pi"));
  writeFileSync(join(projectDir, ".pi", "sprint-review-rules.md"), "<!-- note for people -->\nA ticket counts as delivered only once deployed in PROD.\n");
  process.chdir(projectDir);

  try {
    const calls: string[] = [];
    const statusCalls: Array<string | undefined> = [];
    const { notifyCalls } = await runSprintReviewCommand("--assess", TEST_SPRINT_REVIEW_SNAPSHOT, false, {
      getLlm: async () => ({
        model: TEST_MODEL,
        complete: async ({ system }) => {
          calls.push(system);
          return TEST_LLM_ANSWER;
        },
      }),
      statusCalls,
    });

    assert.match(calls[0] ?? "", /<team_rules>\nA ticket counts as delivered only once deployed in PROD\.\n<\/team_rules>/);
    assert.doesNotMatch(calls[0] ?? "", /note for people/);
    assert.ok(statusCalls.some((text) => text?.endsWith("assessing goals with test-model + team rules…")));
    assert.match(notifyCalls[0]?.message ?? "", /^Summary \(test-model · team rules\):/m);
  } finally {
    process.chdir(originalCwd);
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("registerJiraCommands formats a sprint with no goal, dates or issues", async () => {
  const emptySnapshot: JiraSprintReviewSnapshot = {
    ...TEST_SPRINT_REVIEW_SNAPSHOT,
    sprint: { ...TEST_SPRINT_REVIEW_SNAPSHOT.sprint, goal: null, startDate: null, endDate: null },
    completedIssues: [],
    notCompletedIssues: [],
    puntedIssues: [],
    completedInAnotherSprintIssues: [],
    issueKeysAddedDuringSprint: [],
    issueKeysRemovedDuringSprint: [],
  };

  const { notifyCalls } = await runSprintReviewCommand("", emptySnapshot, false);
  const summary = notifyCalls[0]?.message ?? "";

  assert.match(summary, /^Dates: n\/a → n\/a · days left: Ended$/m);
  assert.match(summary, /^Tickets done: 0 \/ 0 \(\+0 cancelled\)$/m);
  assert.match(summary, /^Points delivered: n\/a · average 84\.6%$/m);
  assert.match(summary, /^Remaining points: n\/a$/m);
});

const FAKE_MODEL = { id: "gpt-5-mini:batch", provider: "openai" };
const FAKE_ANSWER = { role: "assistant", content: [{ type: "text", text: "{\"ok\":true}" }], stopReason: "stop" };

test("piLlmProvider routes through modelRegistry.complete when pi provides it", async () => {
  const calls: unknown[] = [];
  const ctx = {
    ui: { notify() {} },
    model: FAKE_MODEL,
    modelRegistry: {
      async complete(model: unknown, context: { systemPrompt: string; messages: Array<{ content: string }> }) {
        calls.push({ model, system: context.systemPrompt, user: context.messages[0]?.content });
        return FAKE_ANSWER;
      },
      async getApiKeyAndHeaders() {
        throw new Error("must not be called when modelRegistry.complete exists");
      },
    },
  };

  const provider = await piLlmProvider(ctx as never);
  assert.ok(!("error" in provider));
  assert.equal(provider.model, "gpt-5-mini:batch");
  assert.equal(await provider.complete({ system: "sys", user: "usr" }), '{"ok":true}');
  assert.deepEqual(calls, [{ model: FAKE_MODEL, system: "sys", user: "usr" }]);
});

test("piLlmProvider surfaces model errors from modelRegistry.complete", async () => {
  const ctx = {
    ui: { notify() {} },
    model: FAKE_MODEL,
    modelRegistry: {
      async complete() {
        return { role: "assistant", content: [], stopReason: "error", errorMessage: "404: batch model" };
      },
    },
  };

  const provider = await piLlmProvider(ctx as never);
  assert.ok(!("error" in provider));
  await assert.rejects(provider.complete({ system: "s", user: "u" }), /404: batch model/);
});

test("piLlmProvider explains when pi cannot call models or no model is selected", async () => {
  const oldPi = { ui: { notify() {} }, model: FAKE_MODEL, modelRegistry: {} };
  assert.deepEqual(await piLlmProvider(oldPi as never), {
    error: "this pi version cannot call models from extensions; update pi to 1.0 or later",
  });
  assert.deepEqual(await piLlmProvider({ ui: { notify() {} } } as never), { error: "no model is selected in pi" });
});

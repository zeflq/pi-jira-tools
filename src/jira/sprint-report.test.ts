import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSprintReviewMetrics,
  buildSprintReviewSnapshot,
  calculateSprintEstimates,
  getActiveSprintID,
  getTeamVelocity,
  normalizeSprintKeyList,
} from "./sprint-report";
import { createJiraClientConfig } from "./env";
import type { JiraSprintReviewSnapshot } from "./types";

const TEST_PROJECT_KEY = "proj";
const TEST_PROJECT_KEY_UPPER = "PROJ";
const TEST_BOARD_ID = "42";
const TEST_SPRINT_ID = "269035";
const TEST_SPRINT_NAME = "Sprint 12";
const TEST_SPRINT_ESTIMATE_FIELD = "customfield_10016";
const TEST_CLOSED_SPRINT_1_ID = "269001";
const TEST_CLOSED_SPRINT_2_ID = "269002";
const TEST_CLOSED_SPRINT_3_ID = "269003";
const TEST_CLOSED_SPRINT_STATE = "closed";
const TEST_CLOSED_SPRINT_1_NAME = "Sprint 1";
const TEST_CLOSED_SPRINT_2_NAME = "Sprint 2";
const TEST_CLOSED_SPRINT_3_NAME = "Sprint 3";
const TEST_CLOSED_SPRINT_1_START_DATE = "2026-07-01T00:00:00.000Z";
const TEST_CLOSED_SPRINT_1_END_DATE = "2026-07-14T00:00:00.000Z";
const TEST_CLOSED_SPRINT_1_COMPLETE_DATE = "2026-07-14T12:00:00.000Z";
const TEST_CLOSED_SPRINT_2_START_DATE = "2026-07-15T00:00:00.000Z";
const TEST_CLOSED_SPRINT_2_END_DATE = "2026-07-28T00:00:00.000Z";
const TEST_CLOSED_SPRINT_2_COMPLETE_DATE = "2026-07-28T12:00:00.000Z";
const TEST_CLOSED_SPRINT_3_START_DATE = "2026-07-29T00:00:00.000Z";
const TEST_CLOSED_SPRINT_3_END_DATE = "2026-08-11T00:00:00.000Z";
const TEST_CLOSED_SPRINT_3_COMPLETE_DATE = "2026-08-11T12:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("normalizeSprintKeyList handles arrays and object keys", () => {
  assert.deepEqual(normalizeSprintKeyList([" pRoj-1 ", "PROJ-2"]), ["PROJ-1", "PROJ-2"]);
  assert.deepEqual(normalizeSprintKeyList({ "PROJ-3": true, "PROJ-4": false }), ["PROJ-3", "PROJ-4"]);
});

test("buildSprintReviewMetrics resolves issue metadata and counts", () => {
  const metrics = buildSprintReviewMetrics({
    completedIssues: [
      {
        key: "PROJ-1",
        summary: "Done item",
        statusId: "10000",
        typeId: "4",
        priorityId: "3",
        estimateStatistic: {
          statFieldValue: { value: 8 },
        },
      },
    ],
    issuesNotCompletedInCurrentSprint: [
      {
        key: "PROJ-2",
        summary: "In progress item",
        statusId: "3",
        typeId: "10100",
        priorityId: "2",
        estimateStatistic: {
          statFieldValue: { value: 5 },
        },
      },
    ],
    puntedIssues: [
      {
        key: "PROJ-3",
        summary: "Punted item",
        statusName: "Punted",
        typeName: "Task",
        priorityName: "Low",
      },
    ],
    issuesCompletedInAnotherSprint: [],
    issueKeysAddedDuringSprint: { "PROJ-2": true },
    issueKeysRemovedDuringSprint: ["PROJ-6"],
    issueEstimateStatistics: {
      statFieldId: TEST_SPRINT_ESTIMATE_FIELD,
      sum: { value: 13 },
      completedSum: { value: 8 },
    },
    entityData: {
      statuses: {
        "10000": { statusName: "Done" },
        "3": { statusName: "In Progress" },
      },
      types: {
        "4": { typeName: "Task" },
        "10100": { typeName: "Story" },
      },
      priorities: {
        "2": { priorityName: "High" },
        "3": { priorityName: "Major" },
      },
    },
  });

  assert.deepEqual(metrics, {
    completedIssueCount: 1,
    notCompletedIssueCount: 1,
    puntedIssueCount: 1,
    completedInAnotherSprintIssueCount: 0,
    totalIssueCount: 3,
    addedDuringSprintCount: 1,
    removedDuringSprintCount: 1,
    statusCounts: {
      Done: 1,
      "In Progress": 1,
      Punted: 1,
    },
    estimateStatistics: {
      statFieldId: TEST_SPRINT_ESTIMATE_FIELD,
      sum: 13,
      completedSum: 8,
    },
  });
});

test("calculateSprintEstimates computes committed and completed points", () => {
  const snapshot: JiraSprintReviewSnapshot = {
    projectKey: TEST_PROJECT_KEY_UPPER,
    boardId: TEST_BOARD_ID,
    board: {
      id: TEST_BOARD_ID,
      self: null,
      name: "Test Board",
      type: "scrum",
      projectKey: TEST_PROJECT_KEY_UPPER,
      projectName: "Test Board",
      projectType: "project",
    },
    sprint: {
      id: TEST_SPRINT_ID,
      self: null,
      name: TEST_SPRINT_NAME,
      state: "active",
      startDate: "2026-09-23T13:38:00.000Z",
      endDate: "2026-10-06T15:07:00.000Z",
      completeDate: null,
      activatedDate: "2026-09-23T13:43:42.832Z",
      goal: "- Ship Payments-V2",
      originBoardId: TEST_BOARD_ID,
    },
    metrics: {
      completedIssueCount: 1,
      notCompletedIssueCount: 1,
      puntedIssueCount: 1,
      completedInAnotherSprintIssueCount: 0,
      totalIssueCount: 3,
      addedDuringSprintCount: 1,
      removedDuringSprintCount: 0,
      statusCounts: {
        Done: 1,
        "In Progress": 1,
        Punted: 1,
      },
      estimateStatistics: null,
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
    puntedIssues: [
      {
        key: "PROJ-3",
        summary: "Punted item",
        status: "Punted",
        issueType: "Task",
        priority: "Low",
        estimate: null,
        statusCategory: null,
      },
    ],
    completedInAnotherSprintIssues: [],
    issueKeysAddedDuringSprint: ["PROJ-2"],
    issueKeysRemovedDuringSprint: [],
  };

  assert.deepEqual(calculateSprintEstimates(snapshot, false), {
    completedPoints: 8,
    committedPoints: 8,
    remainingPoints: 0,
    reliabilityPercent: 100,
    missingEstimateIssueCount: 1,
  });
  assert.deepEqual(calculateSprintEstimates(snapshot, true), {
    completedPoints: 8,
    committedPoints: 13,
    remainingPoints: 5,
    reliabilityPercent: 61.5,
    missingEstimateIssueCount: 1,
  });
});

test("getActiveSprintID returns the active sprint id for a board", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    fetchCalls.push(`${url.pathname}${url.search}`);

    if (url.pathname === "/rest/agile/1.0/board/42/sprint" && url.searchParams.get("state") === "active") {
      return jsonResponse({
        maxResults: 50,
        startAt: 0,
        isLast: true,
        values: [
          {
            id: Number(TEST_SPRINT_ID),
            self: `https://jira.example.com/rest/agile/1.0/sprint/${TEST_SPRINT_ID}`,
            state: "active",
            name: TEST_SPRINT_NAME,
            originBoardId: Number(TEST_BOARD_ID),
          },
        ],
      });
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const config = createJiraClientConfig({
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_PAT: "pat-value",
      JIRA_PROJECT_KEY: TEST_PROJECT_KEY_UPPER,
      JIRA_ISSUE_TYPE_ID: "10100",
      JIRA_API_VERSION: "2",
    });

    const sprintId = await getActiveSprintID(config, TEST_BOARD_ID);

    assert.equal(sprintId, TEST_SPRINT_ID);
    assert.deepEqual(fetchCalls, ["/rest/agile/1.0/board/42/sprint?state=active"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getTeamVelocity returns a chart-ready series for the last completed sprints", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname === "/rest/agile/1.0/board/42") {
      return jsonResponse({
        id: Number(TEST_BOARD_ID),
        self: `https://jira.example.com/rest/agile/1.0/board/${TEST_BOARD_ID}`,
        name: "Test Board",
        type: "scrum",
        location: {
          projectKey: TEST_PROJECT_KEY_UPPER,
          projectName: "Test Board",
          type: "project",
        },
      });
    }

    if (url.pathname === "/rest/agile/1.0/board/42/sprint" && url.searchParams.get("state") === TEST_CLOSED_SPRINT_STATE) {
      return jsonResponse({
        maxResults: 50,
        startAt: 0,
        isLast: true,
        values: [
          {
            id: Number(TEST_CLOSED_SPRINT_1_ID),
            state: TEST_CLOSED_SPRINT_STATE,
            name: TEST_CLOSED_SPRINT_1_NAME,
            startDate: TEST_CLOSED_SPRINT_1_START_DATE,
            endDate: TEST_CLOSED_SPRINT_1_END_DATE,
            completeDate: TEST_CLOSED_SPRINT_1_COMPLETE_DATE,
            originBoardId: Number(TEST_BOARD_ID),
          },
          {
            id: Number(TEST_CLOSED_SPRINT_2_ID),
            state: TEST_CLOSED_SPRINT_STATE,
            name: TEST_CLOSED_SPRINT_2_NAME,
            startDate: TEST_CLOSED_SPRINT_2_START_DATE,
            endDate: TEST_CLOSED_SPRINT_2_END_DATE,
            completeDate: TEST_CLOSED_SPRINT_2_COMPLETE_DATE,
            originBoardId: Number(TEST_BOARD_ID),
          },
          {
            id: Number(TEST_CLOSED_SPRINT_3_ID),
            state: TEST_CLOSED_SPRINT_STATE,
            name: TEST_CLOSED_SPRINT_3_NAME,
            startDate: TEST_CLOSED_SPRINT_3_START_DATE,
            endDate: TEST_CLOSED_SPRINT_3_END_DATE,
            completeDate: TEST_CLOSED_SPRINT_3_COMPLETE_DATE,
            originBoardId: Number(TEST_BOARD_ID),
          },
        ],
      });
    }

    if (url.pathname === "/rest/greenhopper/1.0/rapid/charts/sprintreport") {
      const sprintId = url.searchParams.get("sprintId");
      if (sprintId === TEST_CLOSED_SPRINT_2_ID) {
        return jsonResponse({
          sprint: {
            id: Number(TEST_CLOSED_SPRINT_2_ID),
            name: TEST_CLOSED_SPRINT_2_NAME,
            state: TEST_CLOSED_SPRINT_STATE,
            startDate: TEST_CLOSED_SPRINT_2_START_DATE,
            endDate: TEST_CLOSED_SPRINT_2_END_DATE,
            completeDate: TEST_CLOSED_SPRINT_2_COMPLETE_DATE,
            activatedDate: "2026-07-15T00:10:00.000Z",
            goal: "- Delivery",
            originBoardId: Number(TEST_BOARD_ID),
          },
          contents: {
            completedIssues: [
              {
                key: "PROJ-20",
                summary: "Done in sprint 2",
                statusId: "10000",
                typeId: "4",
                priorityId: "3",
                estimateStatistic: { statFieldValue: { value: 3 } },
              },
            ],
            issuesNotCompletedInCurrentSprint: [
              {
                key: "PROJ-21",
                summary: "Carryover in sprint 2",
                statusId: "3",
                typeId: "10100",
                priorityId: "2",
                estimateStatistic: { statFieldValue: { value: 2 } },
              },
            ],
            issueKeysAddedDuringSprint: [],
            issueKeysRemovedDuringSprint: [],
            issueEstimateStatistics: {
              statFieldId: TEST_SPRINT_ESTIMATE_FIELD,
              sum: { value: 5 },
              completedSum: { value: 3 },
            },
          },
        });
      }

      if (sprintId === TEST_CLOSED_SPRINT_3_ID) {
        return jsonResponse({
          sprint: {
            id: Number(TEST_CLOSED_SPRINT_3_ID),
            name: TEST_CLOSED_SPRINT_3_NAME,
            state: TEST_CLOSED_SPRINT_STATE,
            startDate: TEST_CLOSED_SPRINT_3_START_DATE,
            endDate: TEST_CLOSED_SPRINT_3_END_DATE,
            completeDate: TEST_CLOSED_SPRINT_3_COMPLETE_DATE,
            activatedDate: "2026-07-29T00:10:00.000Z",
            goal: "- Delivery",
            originBoardId: Number(TEST_BOARD_ID),
          },
          contents: {
            completedIssues: [
              {
                key: "PROJ-30",
                summary: "Done in sprint 3",
                statusId: "10000",
                typeId: "4",
                priorityId: "3",
                estimateStatistic: { statFieldValue: { value: 8 } },
              },
            ],
            issuesNotCompletedInCurrentSprint: [],
            issueKeysAddedDuringSprint: [],
            issueKeysRemovedDuringSprint: [],
            issueEstimateStatistics: {
              statFieldId: TEST_SPRINT_ESTIMATE_FIELD,
              sum: { value: 8 },
              completedSum: { value: 8 },
            },
          },
        });
      }

      throw new Error(`Unexpected sprint report request: ${url.search}`);
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const config = createJiraClientConfig({
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_PAT: "pat-value",
      JIRA_PROJECT_KEY: TEST_PROJECT_KEY_UPPER,
      JIRA_ISSUE_TYPE_ID: "10100",
      JIRA_API_VERSION: "2",
    });

    const series = await getTeamVelocity(config, TEST_PROJECT_KEY_UPPER, TEST_BOARD_ID, 2, false);

    assert.deepEqual(series, {
      boardId: TEST_BOARD_ID,
      windowSize: 2,
      includeAddedDuringSprint: false,
      averageCompletedPoints: 5.5,
      averageCommittedPoints: 6.5,
      reliabilityPercent: 84.6,
      points: [
        {
          sprintId: TEST_CLOSED_SPRINT_2_ID,
          sprintName: TEST_CLOSED_SPRINT_2_NAME,
          startDate: TEST_CLOSED_SPRINT_2_START_DATE,
          endDate: TEST_CLOSED_SPRINT_2_END_DATE,
          completedPoints: 3,
          committedPoints: 5,
          reliabilityPercent: 60,
          includeAddedDuringSprint: false,
        },
        {
          sprintId: TEST_CLOSED_SPRINT_3_ID,
          sprintName: TEST_CLOSED_SPRINT_3_NAME,
          startDate: TEST_CLOSED_SPRINT_3_START_DATE,
          endDate: TEST_CLOSED_SPRINT_3_END_DATE,
          completedPoints: 8,
          committedPoints: 8,
          reliabilityPercent: 100,
          includeAddedDuringSprint: false,
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildSprintReviewSnapshot returns enriched sprint review data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname === "/rest/agile/1.0/board/42") {
      return jsonResponse({
        id: Number(TEST_BOARD_ID),
        self: `https://jira.example.com/rest/agile/1.0/board/${TEST_BOARD_ID}`,
        name: "Test Board",
        type: "scrum",
        location: {
          projectKey: TEST_PROJECT_KEY_UPPER,
          projectName: "Test Board",
          type: "project",
        },
      });
    }

    if (url.pathname === "/rest/agile/1.0/board/42/sprint" && url.searchParams.get("state") === "active") {
      return jsonResponse({
        values: [
          {
            id: Number(TEST_SPRINT_ID),
            self: `https://jira.example.com/rest/agile/1.0/sprint/${TEST_SPRINT_ID}`,
            state: "active",
            name: TEST_SPRINT_NAME,
            originBoardId: Number(TEST_BOARD_ID),
          },
        ],
      });
    }

    if (url.pathname === "/rest/greenhopper/1.0/rapid/charts/sprintreport") {
      return jsonResponse({
        sprint: {
          id: Number(TEST_SPRINT_ID),
          name: TEST_SPRINT_NAME,
          state: "active",
          startDate: "2026-09-23T13:38:00.000Z",
          endDate: "2026-10-06T15:07:00.000Z",
          activatedDate: "2026-09-23T13:43:42.832Z",
          goal: "- Ship Payments-V2",
          originBoardId: Number(TEST_BOARD_ID),
        },
        contents: {
          completedIssues: [
            {
              key: "PROJ-1",
              summary: "Done item",
              statusId: "10000",
              typeId: "4",
              priorityId: "3",
              estimateStatistic: {
                statFieldValue: { value: 8 },
              },
            },
          ],
          issuesNotCompletedInCurrentSprint: [
            {
              key: "PROJ-2",
              summary: "In progress item",
              statusId: "3",
              typeId: "10100",
              priorityId: "2",
              estimateStatistic: {
                statFieldValue: { value: 5 },
              },
            },
          ],
          issueKeysAddedDuringSprint: { "PROJ-2": true },
          issueKeysRemovedDuringSprint: { "PROJ-6": true },
          issueEstimateStatistics: {
            statFieldId: TEST_SPRINT_ESTIMATE_FIELD,
            sum: { value: 13 },
            completedSum: { value: 8 },
          },
          entityData: {
            statuses: {
              "10000": { statusName: "Done" },
              "3": { statusName: "In Progress" },
            },
            types: {
              "4": { typeName: "Task" },
              "10100": { typeName: "Story" },
            },
            priorities: {
              "2": { priorityName: "High" },
              "3": { priorityName: "Major" },
            },
          },
        },
      });
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const config = createJiraClientConfig({
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_PAT: "pat-value",
      JIRA_PROJECT_KEY: TEST_PROJECT_KEY_UPPER,
      JIRA_ISSUE_TYPE_ID: "10100",
      JIRA_API_VERSION: "2",
    });

    const snapshot = await buildSprintReviewSnapshot(config, TEST_PROJECT_KEY_UPPER, TEST_BOARD_ID);

    assert.deepEqual(snapshot.completedIssues, [
      {
        key: "PROJ-1",
        summary: "Done item",
        status: "Done",
        issueType: "Task",
        priority: "Major",
        estimate: 8,
        statusCategory: null,
      },
    ]);
    assert.deepEqual(snapshot.notCompletedIssues, [
      {
        key: "PROJ-2",
        summary: "In progress item",
        status: "In Progress",
        issueType: "Story",
        priority: "High",
        estimate: 5,
        statusCategory: null,
      },
    ]);
    assert.deepEqual(snapshot.issueKeysAddedDuringSprint, ["PROJ-2"]);
    assert.deepEqual(snapshot.issueKeysRemovedDuringSprint, ["PROJ-6"]);
    assert.equal(snapshot.metrics.estimateStatistics?.completedSum, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildSprintReviewSnapshot prefers ISO dates and treats 'None' as no date", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));

    if (url.pathname === "/rest/agile/1.0/board/42") {
      return jsonResponse({ id: 42, name: "Test Board", type: "scrum", location: { projectKey: TEST_PROJECT_KEY_UPPER } });
    }

    if (url.pathname === "/rest/agile/1.0/board/42/sprint") {
      return jsonResponse({ values: [{ id: Number(TEST_SPRINT_ID), state: "active", name: TEST_SPRINT_NAME }] });
    }

    if (url.pathname === "/rest/greenhopper/1.0/rapid/charts/sprintreport") {
      return jsonResponse({
        sprint: {
          id: Number(TEST_SPRINT_ID),
          name: TEST_SPRINT_NAME,
          state: "ACTIVE",
          startDate: "03/Oct/26 11:00 AM",
          endDate: "17/Oct/26 7:00 PM",
          completeDate: "None",
          isoStartDate: "2026-10-03T11:00:00+0200",
          isoEndDate: "2026-10-17T19:00:00+0200",
          isoCompleteDate: "None",
        },
        contents: {},
      });
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const config = createJiraClientConfig({ JIRA_BASE_URL: "https://jira.example.com", JIRA_PAT: "pat-value" });
    const snapshot = await buildSprintReviewSnapshot(config, TEST_PROJECT_KEY_UPPER, TEST_BOARD_ID);

    assert.equal(snapshot.sprint.startDate, "2026-10-03T11:00:00+0200");
    assert.equal(snapshot.sprint.endDate, "2026-10-17T19:00:00+0200");
    assert.equal(snapshot.sprint.completeDate, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildSprintReviewMetrics reads the status category from entityData", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/agile/1.0/board/42") {
      return jsonResponse({ id: 42, name: "Test Board", location: { projectKey: TEST_PROJECT_KEY_UPPER } });
    }
    if (url.pathname === "/rest/agile/1.0/board/42/sprint") {
      return jsonResponse({ values: [{ id: Number(TEST_SPRINT_ID), state: "active", name: TEST_SPRINT_NAME }] });
    }
    return jsonResponse({
      sprint: { id: Number(TEST_SPRINT_ID), name: TEST_SPRINT_NAME, state: "ACTIVE" },
      contents: {
        issuesNotCompletedInCurrentSprint: [{ key: "PROJ-1", summary: "Todo", statusId: "1" }],
        entityData: { statuses: { "1": { statusName: "To Do", statusCategory: { key: "new" } } } },
      },
    });
  }) as typeof fetch;

  try {
    const config = createJiraClientConfig({ JIRA_BASE_URL: "https://jira.example.com", JIRA_PAT: "pat-value" });
    const snapshot = await buildSprintReviewSnapshot(config, TEST_PROJECT_KEY_UPPER, TEST_BOARD_ID);
    assert.equal(snapshot.notCompletedIssues[0]?.status, "To Do");
    assert.equal(snapshot.notCompletedIssues[0]?.statusCategory, "new");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

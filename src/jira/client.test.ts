import assert from "node:assert/strict";
import test from "node:test";
import { createJiraClient } from "./client";

const TEST_PAT = "pat-value";
const TEST_PROJECT_KEY = "PROJ";
const TEST_BOARD_ID = "42";
const TEST_SPRINT_ID = "269035";
const TEST_ISSUE_KEY = "PROJ-1";
const TEST_COMMENT_ID = "55";
const TEST_SPRINT_NAME = "Sprint 12";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("createJiraClient wires issue CRUD methods", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/rest/api/2/issue" && method === "POST") {
      return jsonResponse({ id: "1", key: TEST_ISSUE_KEY });
    }

    if (url.pathname === `/rest/api/2/issue/${TEST_ISSUE_KEY}` && method === "GET") {
      return jsonResponse({
        id: "1",
        key: TEST_ISSUE_KEY,
        fields: {
          summary: "Done item",
          description: "Done description",
          status: { name: "Done" },
          priority: { name: "Major" },
          issuetype: { name: "Task" },
          labels: ["pi"],
        },
      });
    }

    if (url.pathname === `/rest/api/2/issue/${TEST_ISSUE_KEY}` && method === "PUT") {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === `/rest/api/2/issue/${TEST_ISSUE_KEY}/comment` && method === "POST") {
      return jsonResponse({ id: TEST_COMMENT_ID, body: "Looks good", created: "2026-10-01T10:00:00.000Z" });
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}`);
  }) as typeof fetch;

  try {
    const client = createJiraClient({
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_PAT: TEST_PAT,
      JIRA_PROJECT_KEY: TEST_PROJECT_KEY,
      JIRA_ISSUE_TYPE_ID: "10100",
      JIRA_API_VERSION: "2",
    });

    const created = await client.createIssue({ summary: "Create issue" });
    assert.equal(created.key, TEST_ISSUE_KEY);

    const issue = await client.getIssue(TEST_ISSUE_KEY);
    assert.equal(issue.summary, "Done item");
    assert.equal(issue.priority, "Major");

    const updated = await client.updateIssue({ issueKey: TEST_ISSUE_KEY, summary: "Updated" });
    assert.equal(updated.key, TEST_ISSUE_KEY);

    const comment = await client.addComment({ issueKey: TEST_ISSUE_KEY, comment: "Looks good" });
    assert.equal(comment.id, TEST_COMMENT_ID);
    assert.equal(comment.url, `https://jira.example.com/browse/${TEST_ISSUE_KEY}?focusedCommentId=${TEST_COMMENT_ID}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createJiraClient wires sprint review snapshot retrieval", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/rest/agile/1.0/board/42") {
      return jsonResponse({
        id: Number(TEST_BOARD_ID),
        name: "Test Board",
        type: "scrum",
        location: {
          projectKey: TEST_PROJECT_KEY,
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
            name: TEST_SPRINT_NAME,
            state: "active",
            originBoardId: Number(TEST_BOARD_ID),
          },
        ],
      });
    }

    if (url.pathname === "/rest/greenhopper/1.0/rapid/charts/sprintreport" && method === "GET") {
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
          issuesNotCompletedInCurrentSprint: [],
          puntedIssues: [],
          issuesCompletedInAnotherSprint: [],
          issueKeysAddedDuringSprint: { "PROJ-1": true },
          issueKeysRemovedDuringSprint: {},
          issueEstimateStatistics: {
            statFieldId: "customfield_10016",
            sum: { value: 13 },
            completedSum: { value: 8 },
          },
          entityData: {
            statuses: {
              "10000": { statusName: "Done" },
            },
            types: {
              "4": { typeName: "Task" },
            },
            priorities: {
              "3": { priorityName: "Major" },
            },
          },
        },
      });
    }

    throw new Error(`Unexpected Jira request: ${url.pathname}${url.search}`);
  }) as typeof fetch;

  try {
    const client = createJiraClient({
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_PAT: TEST_PAT,
      JIRA_PROJECT_KEY: TEST_PROJECT_KEY,
      JIRA_ISSUE_TYPE_ID: "10100",
      JIRA_API_VERSION: "2",
    });

    const snapshot = await client.getSprintReviewSnapshot(TEST_PROJECT_KEY, TEST_BOARD_ID);

    assert.equal(snapshot.sprint.id, TEST_SPRINT_ID);
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
    assert.deepEqual(snapshot.issueKeysAddedDuringSprint, ["PROJ-1"]);
    assert.equal(snapshot.metrics.estimateStatistics?.completedSum, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

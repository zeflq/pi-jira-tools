import assert from "node:assert/strict";
import test from "node:test";
import {
  JiraApiError,
  JiraAuthError,
  JiraCreateIssueError,
  requestJira,
} from "./http";

const TEST_PAT = "pat-value";
const TEST_BASE_URL = "https://jira.example.com";
const TEST_HEADERS = {
  Authorization: `Bearer ${TEST_PAT}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

test("requestJira returns parsed data on success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ ok: true })) as typeof fetch;

  try {
    const result = await requestJira<{ ok: boolean }>(
      {
        baseUrl: TEST_BASE_URL,
        headers: TEST_HEADERS,
        issueTypeId: "10100",
        apiVersion: "2",
        cancelledStatuses: [],
        almostDoneStatuses: [],
        notStartedStatuses: [],
      },
      "GET",
      "/rest/api/2/serverInfo"
    );

    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJira maps 401 and 403 to JiraAuthError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse(
      {
        errorMessages: ["Client must be authenticated to access this resource."],
        errors: {},
      },
      403
    )) as typeof fetch;

  try {
    await assert.rejects(
      requestJira(
        {
          baseUrl: TEST_BASE_URL,
          headers: TEST_HEADERS,
          issueTypeId: "10100",
          apiVersion: "2",
          cancelledStatuses: [],
          almostDoneStatuses: [],
          notStartedStatuses: [],
        },
        "GET",
        "/rest/agile/1.0/board/42"
      ),
      (error: unknown) => error instanceof JiraAuthError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJira maps create validation failures to JiraCreateIssueError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    jsonResponse(
      {
        errorMessages: [],
        errors: {
          summary: "Field 'summary' cannot be set. It is not on the appropriate screen, or unknown.",
        },
      },
      400
    )) as typeof fetch;

  try {
    await assert.rejects(
      requestJira(
        {
          baseUrl: TEST_BASE_URL,
          headers: TEST_HEADERS,
          issueTypeId: "10100",
          apiVersion: "2",
          cancelledStatuses: [],
          almostDoneStatuses: [],
          notStartedStatuses: [],
        },
        "POST",
        "/rest/api/2/issue",
        { fields: { summary: "Test" } }
      ),
      (error: unknown) => error instanceof JiraCreateIssueError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requestJira maps generic Jira errors to JiraApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => jsonResponse({ message: "Boom" }, 500)) as typeof fetch;

  try {
    await assert.rejects(
      requestJira(
        {
          baseUrl: TEST_BASE_URL,
          headers: TEST_HEADERS,
          issueTypeId: "10100",
          apiVersion: "2",
          cancelledStatuses: [],
          almostDoneStatuses: [],
          notStartedStatuses: [],
        },
        "GET",
        "/rest/api/2/issue/PROJ-1"
      ),
      (error: unknown) => error instanceof JiraApiError
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

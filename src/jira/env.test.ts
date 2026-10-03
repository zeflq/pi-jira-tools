import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthHeader,
  createJiraClientConfig,
  normalizeIssueKey,
  normalizeProjectKey,
  validateJiraStartupConfig,
} from "./env";

const TEST_PROJECT_KEY = "proj";
const TEST_PROJECT_KEY_UPPER = "PROJ";
const TEST_PAT = "pat-value";
const TEST_EMAIL = "pi@example.com";
const TEST_API_TOKEN = "api-token-value";
const TEST_BOARD_ID = "42";
const TEST_ACCEPTANCE_CRITERIA_FIELD = "customfield_12345";

test("normalizeProjectKey uppercases and validates keys", () => {
  assert.equal(normalizeProjectKey(TEST_PROJECT_KEY), TEST_PROJECT_KEY_UPPER);
});

test("normalizeIssueKey rejects invalid keys", () => {
  assert.throws(() => {
    normalizeIssueKey("not-a-ticket");
  }, /Invalid Jira issue key/i);
});

test("createJiraClientConfig uses the Jira issue type id and shared base config", () => {
  const config = createJiraClientConfig({
    JIRA_BASE_URL: "https://jira.example.com",
    JIRA_PAT: TEST_PAT,
    JIRA_EMAIL: TEST_EMAIL,
    JIRA_PROJECT_KEY: TEST_PROJECT_KEY,
    JIRA_BOARD_ID: TEST_BOARD_ID,
    JIRA_ISSUE_TYPE_ID: "10100",
    JIRA_ACCEPTANCE_CRITERIA_FIELD: TEST_ACCEPTANCE_CRITERIA_FIELD,
    JIRA_API_VERSION: "2",
  });

  assert.deepEqual(config, {
    baseUrl: "https://jira.example.com/",
    headers: {
      Authorization: `Bearer ${TEST_PAT}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    projectKey: TEST_PROJECT_KEY,
    email: TEST_EMAIL,
    boardId: TEST_BOARD_ID,
    issueTypeId: "10100",
    apiVersion: "2",
    acceptanceCriteriaField: TEST_ACCEPTANCE_CRITERIA_FIELD,
    cancelledStatuses: [],
    almostDoneStatuses: [],
    notStartedStatuses: ["To Do", "To refine", "Open", "Backlog"],
  });
});

test("createJiraClientConfig parses cancelled and almost-done statuses from env", () => {
  const config = createJiraClientConfig({
    JIRA_BASE_URL: "https://jira.example.com",
    JIRA_PAT: TEST_PAT,
    JIRA_CANCELLED_STATUSES: "Cancelled, Won't Do ,",
    JIRA_ALMOST_DONE_STATUSES: "To Merge,In Review,To Deploy UAT",
  });

  assert.deepEqual(config.cancelledStatuses, ["Cancelled", "Won't Do"]);
  assert.deepEqual(config.almostDoneStatuses, ["To Merge", "In Review", "To Deploy UAT"]);
});

test("buildAuthHeader prefers PAT when both auth modes are configured", () => {
  assert.equal(
    buildAuthHeader({ JIRA_PAT: TEST_PAT, JIRA_EMAIL: TEST_EMAIL, JIRA_API_TOKEN: TEST_API_TOKEN }),
    `Bearer ${TEST_PAT}`
  );
});

test("buildAuthHeader uses Basic auth with email and API token for Jira Cloud", () => {
  const expected = Buffer.from(`${TEST_EMAIL}:${TEST_API_TOKEN}`).toString("base64");
  assert.equal(buildAuthHeader({ JIRA_EMAIL: TEST_EMAIL, JIRA_API_TOKEN: TEST_API_TOKEN }), `Basic ${expected}`);
});

test("buildAuthHeader throws when no Jira credentials are configured", () => {
  assert.throws(() => {
    buildAuthHeader({ JIRA_EMAIL: TEST_EMAIL });
  }, /Configure Jira authentication with JIRA_PAT/i);
});

test("validateJiraStartupConfig returns the shared Jira config", () => {
  const config = validateJiraStartupConfig({
    JIRA_BASE_URL: "https://jira.example.com",
    JIRA_PAT: TEST_PAT,
    JIRA_PROJECT_KEY: TEST_PROJECT_KEY,
    JIRA_ISSUE_TYPE_ID: "10100",
    JIRA_API_VERSION: "2",
  });

  assert.equal(config.baseUrl, "https://jira.example.com/");
  assert.equal(config.headers.Authorization, `Bearer ${TEST_PAT}`);
});

test("validateJiraStartupConfig throws a clear startup error when base url is missing", () => {
  assert.throws(() => {
    validateJiraStartupConfig({
      JIRA_PAT: TEST_PAT,
    });
  }, /startup check failed/i);
});

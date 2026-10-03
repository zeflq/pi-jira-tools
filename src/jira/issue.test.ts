import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommentPayload,
  buildCreateIssuePayload,
  buildUpdateIssuePayload,
  formatMarkdownAcceptanceCriteria,
  formatMarkdownComment,
  toCommentDetails,
  toIssueDetails,
} from "./issue";

const TEST_PROJECT_KEY = "proj";
const TEST_PROJECT_KEY_UPPER = "PROJ";
const TEST_ISSUE_KEY = "proj-123";
const TEST_SUMMARY = "Add Jira support for PI";
const TEST_DESCRIPTION = "Create, update, get, and comment on Jira issues.";
const TEST_ACCEPTANCE_CRITERIA = "Given the user asks for Jira support, when PI confirms the request, then PI shows the created ticket link.";
const TEST_UPDATED_SUMMARY = "Update Jira support for PI";
const TEST_PRIORITY = "High";
const TEST_LABEL = "pi";
const TEST_ACCEPTANCE_CRITERIA_FIELD = "customfield_12345";

test("buildCreateIssuePayload keeps the requested Jira create fields", () => {
  const payload = buildCreateIssuePayload(
    {
      issueTypeId: "10100",
      summary: TEST_SUMMARY,
      description: TEST_DESCRIPTION,
      acceptanceCriteria: TEST_ACCEPTANCE_CRITERIA,
    },
    {
      baseUrl: "https://jira.example.com/",
      headers: {},
      projectKey: TEST_PROJECT_KEY,
      issueTypeId: "10100",
      apiVersion: "2",
      acceptanceCriteriaField: TEST_ACCEPTANCE_CRITERIA_FIELD,
      cancelledStatuses: [],
      almostDoneStatuses: [],
      notStartedStatuses: [],
    }
  );

  assert.deepEqual(payload, {
    fields: {
      project: { key: TEST_PROJECT_KEY_UPPER },
      summary: TEST_SUMMARY,
      issuetype: { id: "10100" },
      description: TEST_DESCRIPTION,
      [TEST_ACCEPTANCE_CRITERIA_FIELD]: TEST_ACCEPTANCE_CRITERIA,
    },
  });
});

test("buildCreateIssuePayload defaults to Story when no issue type is provided", () => {
  const payload = buildCreateIssuePayload(
    {
      summary: TEST_SUMMARY,
    },
    {
      baseUrl: "https://jira.example.com/",
      headers: {},
      projectKey: TEST_PROJECT_KEY,
      issueTypeId: "10100",
      apiVersion: "2",
      acceptanceCriteriaField: TEST_ACCEPTANCE_CRITERIA_FIELD,
      cancelledStatuses: [],
      almostDoneStatuses: [],
      notStartedStatuses: [],
    }
  );

  assert.deepEqual(payload, {
    fields: {
      project: { key: TEST_PROJECT_KEY_UPPER },
      summary: TEST_SUMMARY,
      issuetype: { name: "Story" },
    },
  });
});

test("buildUpdateIssuePayload keeps the requested Jira update fields", () => {
  const payload = buildUpdateIssuePayload({
    issueKey: TEST_ISSUE_KEY,
    summary: TEST_UPDATED_SUMMARY,
    description: TEST_DESCRIPTION,
    labels: [TEST_LABEL],
    priority: TEST_PRIORITY,
  });

  assert.deepEqual(payload, {
    fields: {
      summary: TEST_UPDATED_SUMMARY,
      description: TEST_DESCRIPTION,
      labels: [TEST_LABEL],
      priority: { name: TEST_PRIORITY },
    },
  });
});

test("buildCommentPayload trims the comment body", () => {
  assert.deepEqual(buildCommentPayload(`  ${TEST_DESCRIPTION}  `), {
    body: TEST_DESCRIPTION,
  });
});

test("formatMarkdownAcceptanceCriteria renders a markdown list with heading", () => {
  assert.equal(
    formatMarkdownAcceptanceCriteria([
      "Given valid credentials",
      "When the user signs in",
      "Then the app redirects to the dashboard",
    ]),
    [
      "### Acceptance criteria",
      "- Given valid credentials",
      "- When the user signs in",
      "- Then the app redirects to the dashboard",
    ].join("\n")
  );
});

test("formatMarkdownComment renders a markdown bullet list", () => {
  assert.equal(
    formatMarkdownComment([
      "Root cause: wrong auth token",
      "Fix: use JIRA_PAT",
      "Next step: rerun the manual test",
    ]),
    [
      "- Root cause: wrong auth token",
      "- Fix: use JIRA_PAT",
      "- Next step: rerun the manual test",
    ].join("\n")
  );
});

test("formatMarkdown helpers reject empty content", () => {
  assert.throws(() => {
    formatMarkdownAcceptanceCriteria(["   "]);
  }, /acceptance criteria must contain at least one non-empty value/i);

  assert.throws(() => {
    formatMarkdownComment(["   "]);
  }, /comment must contain at least one non-empty value/i);
});

test("toIssueDetails maps Jira issue data", () => {
  const issue = toIssueDetails("https://jira.example.com/", {
    id: "1",
    key: "PROJ-1",
    fields: {
      summary: "Done item",
      description: "Done description",
      status: { name: "Done" },
      priority: { name: "Major" },
      issuetype: { name: "Task" },
      labels: ["pi"],
    },
  });

  assert.deepEqual(issue, {
    id: "1",
    key: "PROJ-1",
    url: "https://jira.example.com/browse/PROJ-1",
    summary: "Done item",
    description: "Done description",
    status: "Done",
    priority: "Major",
    issueType: "Task",
    labels: ["pi"],
  });
});

test("toCommentDetails maps Jira comment data", () => {
  const comment = toCommentDetails("https://jira.example.com/", TEST_ISSUE_KEY, {
    id: "55",
    body: "Looks good",
    created: "2026-10-01T10:00:00.000Z",
  });

  assert.deepEqual(comment, {
    id: "55",
    body: "Looks good",
    created: "2026-10-01T10:00:00.000Z",
    url: "https://jira.example.com/browse/PROJ-123?focusedCommentId=55",
  });
});

test("buildCreateIssuePayload appends acceptance criteria to the description when no field is configured", () => {
  const payload = buildCreateIssuePayload(
    {
      summary: TEST_SUMMARY,
      description: TEST_DESCRIPTION,
      acceptanceCriteria: TEST_ACCEPTANCE_CRITERIA,
    },
    {
      baseUrl: "https://jira.example.com/",
      headers: {},
      projectKey: TEST_PROJECT_KEY,
      issueTypeId: "10100",
      apiVersion: "2",
      cancelledStatuses: [],
      almostDoneStatuses: [],
      notStartedStatuses: [],
    }
  );

  assert.deepEqual(payload, {
    fields: {
      project: { key: TEST_PROJECT_KEY_UPPER },
      summary: TEST_SUMMARY,
      issuetype: { name: "Story" },
      description: `${TEST_DESCRIPTION}\n\n${TEST_ACCEPTANCE_CRITERIA}`,
    },
  });
});

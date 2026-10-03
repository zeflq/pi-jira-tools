import type { JiraClientConfig, JiraEnv } from "./types";

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]+$/;
const BOARD_ID_RE = /^\d+$/;

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = requireNonEmpty(value, "JIRA_BASE_URL");
  try {
    const url = new URL(trimmed);
    return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
  } catch {
    throw new Error(`JIRA_BASE_URL is not a valid URL: ${value}`);
  }
}

export function normalizeProjectKey(value: string): string {
  const normalized = requireNonEmpty(value, "projectKey").toUpperCase();
  if (!PROJECT_KEY_RE.test(normalized)) {
    throw new Error(`Invalid Jira project key: ${value}`);
  }
  return normalized;
}

export function normalizeIssueKey(value: string): string {
  const normalized = requireNonEmpty(value, "issueKey").toUpperCase();
  if (!ISSUE_KEY_RE.test(normalized)) {
    throw new Error(`Invalid Jira issue key: ${value}`);
  }
  return normalized;
}

export function normalizeBoardId(value: string | number): string {
  const normalized = String(value).trim();
  if (!BOARD_ID_RE.test(normalized)) {
    throw new Error(`Invalid Jira board id: ${value}`);
  }
  return normalized;
}

// Used when Jira does not report a status category (some Server / Data Center sprint reports).
const DEFAULT_NOT_STARTED_STATUSES = "To Do,To refine,Open,Backlog";

function parseStatusList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((status) => status.trim())
    // Strip optional surrounding single or double quotes from each token
    .map((status) => status.replace(/^['"]+|['"]+$/g, ""))
    .filter((status) => status.length > 0);
}

export function buildAuthHeader(env: JiraEnv = process.env): string {
  const pat = env.JIRA_PAT?.trim();
  if (pat) {
    return `Bearer ${pat}`;
  }

  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();
  if (email && apiToken) {
    return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  throw new Error("Configure Jira authentication with JIRA_PAT (Server/Data Center) or JIRA_EMAIL and JIRA_API_TOKEN (Cloud).");
}

export function createJiraClientConfig(env: JiraEnv = process.env): JiraClientConfig {
  return {
    baseUrl: normalizeBaseUrl(env.JIRA_BASE_URL ?? ""),
    headers: {
      Authorization: buildAuthHeader(env),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    projectKey: env.JIRA_PROJECT_KEY?.trim(),
    email: env.JIRA_EMAIL?.trim(),
    boardId: env.JIRA_BOARD_ID?.trim() || undefined,
    issueTypeId: env.JIRA_ISSUE_TYPE_ID?.trim() || "",
    apiVersion: env.JIRA_API_VERSION?.trim() || "2",
    acceptanceCriteriaField: env.JIRA_ACCEPTANCE_CRITERIA_FIELD?.trim() || undefined,
    cancelledStatuses: parseStatusList(env.JIRA_CANCELLED_STATUSES),
    almostDoneStatuses: parseStatusList(env.JIRA_ALMOST_DONE_STATUSES),
    notStartedStatuses: parseStatusList(env.JIRA_NOT_STARTED_STATUSES ?? DEFAULT_NOT_STARTED_STATUSES),
  };
}

export function validateJiraStartupConfig(env: JiraEnv = process.env): JiraClientConfig {
  try {
    return createJiraClientConfig(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Jira tools startup check failed: ${message}. Confirm JIRA_BASE_URL and either JIRA_PAT or JIRA_EMAIL + JIRA_API_TOKEN are set in the PI runtime.`
    );
  }
}

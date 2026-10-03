import type { JiraClientConfig } from "./types";

export class JiraApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Jira request failed with status ${status}: ${responseBody || "no response body"}`);
    this.name = "JiraApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class JiraAuthError extends JiraApiError {
  constructor(status: number, responseBody: string) {
    super(status, responseBody);
    this.name = "JiraAuthError";
    this.message = `Jira authentication failed with status ${status}: ${responseBody || "no response body"}`;
  }
}

export class JiraCreateIssueError extends JiraApiError {
  constructor(status: number, responseBody: string) {
    super(status, responseBody);
    this.name = "JiraCreateIssueError";
    this.message = `Jira issue creation failed with status ${status}: ${responseBody || "no response body"}`;
  }
}

function isAuthFailure(status: number, responseBody: string): boolean {
  if (status === 401 || status === 403) {
    return true;
  }

  const normalized = responseBody.toLowerCase();
  return (
    normalized.includes("client must be authenticated") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid token") ||
    normalized.includes("invalid pat")
  );
}

function isCreateIssueScreenFailure(method: string, path: string, responseBody: string): boolean {
  if (method !== "POST" || !path.endsWith("/issue")) {
    return false;
  }

  const normalized = responseBody.toLowerCase();
  return (
    normalized.includes("cannot be set") ||
    normalized.includes("not on the appropriate screen") ||
    normalized.includes("field 'summary'") ||
    normalized.includes("field 'description'")
  );
}

export async function requestJira<T>(config: JiraClientConfig, method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, config.baseUrl);
  const response = await fetch(url, {
    method,
    headers: config.headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    if (isAuthFailure(response.status, responseBody)) {
      throw new JiraAuthError(response.status, responseBody);
    }

    if (isCreateIssueScreenFailure(method, path, responseBody)) {
      throw new JiraCreateIssueError(response.status, responseBody);
    }

    throw new JiraApiError(response.status, responseBody);
  }

  if (!responseBody) {
    return undefined as T;
  }

  return JSON.parse(responseBody) as T;
}

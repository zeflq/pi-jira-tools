import type { JiraClientConfig, JiraCommentDetails, JiraCreateIssueInput, JiraIssueDetails, JiraUpdateIssueInput } from "./types";
import { normalizeIssueKey, normalizeProjectKey } from "./env";

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

function sanitizeLabelList(labels: string[] | undefined): string[] | undefined {
  if (labels === undefined) {
    return undefined;
  }

  const sanitized = labels.map((label) => label.trim()).filter((label) => label.length > 0);
  if (sanitized.length === 0) {
    return undefined;
  }
  return sanitized;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

export function buildIssueUrl(baseUrl: string, issueKey: string): string {
  return new URL(`browse/${normalizeIssueKey(issueKey)}`, baseUrl).href;
}

export function buildCreateIssuePayload(input: JiraCreateIssueInput, config: JiraClientConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    project: { key: normalizeProjectKey(config.projectKey ?? "") },
    summary: requireNonEmpty(input.summary, "summary"),
  };

  const issueTypeId = input.issueTypeId?.trim();
  const issueTypeName = input.issueType?.trim();
  if (issueTypeId) {
    fields.issuetype = { id: issueTypeId };
  } else if (issueTypeName) {
    fields.issuetype = { name: issueTypeName };
  } else {
    fields.issuetype = { name: "Story" };
  }

  const acceptanceCriteria = input.acceptanceCriteria?.trim();
  const acceptanceCriteriaField = config.acceptanceCriteriaField;
  if (acceptanceCriteria && acceptanceCriteriaField) {
    fields[acceptanceCriteriaField] = acceptanceCriteria;
  }

  // Without a dedicated custom field, acceptance criteria go at the end of the description.
  const descriptionParts = [input.description?.trim()];
  if (acceptanceCriteria && !acceptanceCriteriaField) {
    descriptionParts.push(acceptanceCriteria);
  }
  const description = descriptionParts.filter((part) => part).join("\n\n");
  if (description) {
    fields.description = description;
  }

  return { fields: compactObject(fields) };
}

export function buildUpdateIssuePayload(input: JiraUpdateIssueInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  const summary = input.summary?.trim();
  if (summary) {
    fields.summary = summary;
  }

  const description = input.description?.trim();
  if (description) {
    fields.description = description;
  }

  const labels = sanitizeLabelList(input.labels);
  if (labels !== undefined) {
    fields.labels = labels;
  }

  const priority = input.priority?.trim();
  if (priority) {
    fields.priority = { name: priority };
  }

  const payload = compactObject({ fields });
  if (Object.keys(payload.fields ?? {}).length === 0) {
    throw new Error("At least one Jira field must be provided to update an issue.");
  }

  return payload;
}

export function buildCommentPayload(comment: string): Record<string, unknown> {
  return { body: requireNonEmpty(comment, "comment") };
}

export function formatMarkdownAcceptanceCriteria(items: string[]): string {
  const normalized = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new Error("acceptance criteria must contain at least one non-empty value.");
  }
  return ["### Acceptance criteria", ...normalized.map((item) => `- ${item}`)].join("\n");
}

export function formatMarkdownComment(items: string[]): string {
  const normalized = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new Error("comment must contain at least one non-empty value.");
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

export function toIssueDetails(
  baseUrl: string,
  issue: {
    id: string;
    key: string;
    fields?: {
      summary?: string;
      description?: string;
      status?: { name?: string };
      priority?: { name?: string };
      issuetype?: { name?: string };
      labels?: string[];
    };
  }
): JiraIssueDetails {
  const fields = issue.fields ?? {};
  return {
    id: issue.id,
    key: issue.key,
    url: buildIssueUrl(baseUrl, issue.key),
    summary: fields.summary ?? "",
    description: fields.description ?? "",
    status: fields.status?.name ?? null,
    priority: fields.priority?.name ?? null,
    issueType: fields.issuetype?.name ?? null,
    labels: fields.labels ?? [],
  };
}

export function toCommentDetails(baseUrl: string, issueKey: string, comment: { id: string; body?: string; created?: string }): JiraCommentDetails {
  return {
    id: comment.id,
    body: comment.body ?? "",
    created: comment.created ?? null,
    url: new URL(`browse/${normalizeIssueKey(issueKey)}?focusedCommentId=${comment.id}`, baseUrl).href,
  };
}

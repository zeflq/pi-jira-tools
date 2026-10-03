import {
  createJiraClientConfig,
  buildAuthHeader,
  normalizeBaseUrl,
  normalizeBoardId,
  normalizeIssueKey,
  normalizeProjectKey,
  validateJiraStartupConfig,
} from "./env";
import { JiraApiError, JiraAuthError, JiraCreateIssueError, requestJira } from "./http";
import {
  buildCommentPayload,
  buildCreateIssuePayload,
  buildIssueUrl,
  buildUpdateIssuePayload,
  formatMarkdownAcceptanceCriteria,
  formatMarkdownComment,
  toCommentDetails,
  toIssueDetails,
} from "./issue";
import { buildSprintReviewSnapshot, getTeamVelocity } from "./sprint-report";
import type {
  JiraClient,
  JiraClientConfig,
  JiraCommentDetails,
  JiraCommentInput,
  JiraCreateIssueInput,
  JiraIssueDetails,
  JiraSprintReviewSnapshot,
  JiraUpdateIssueInput,
  TeamVelocitySeries,
} from "./types";

export type {
  JiraBoardDetails,
  JiraClient,
  JiraClientConfig,
  JiraCommentDetails,
  JiraCommentInput,
  JiraCreateIssueInput,
  JiraIssueDetails,
  JiraSprintDetails,
  JiraSprintEstimateStatistics,
  JiraSprintReviewIssue,
  JiraSprintReviewMetrics,
  JiraSprintReviewSnapshot,
  JiraUpdateIssueInput,
  SprintEstimateSummary,
  TeamVelocityPoint,
  TeamVelocitySeries,
} from "./types";
export {
  createJiraClientConfig,
  buildAuthHeader,
  normalizeBaseUrl,
  normalizeBoardId,
  normalizeIssueKey,
  normalizeProjectKey,
  validateJiraStartupConfig,
} from "./env";
export { JiraApiError, JiraAuthError, JiraCreateIssueError, requestJira } from "./http";
export {
  buildCommentPayload,
  buildCreateIssuePayload,
  buildIssueUrl,
  buildUpdateIssuePayload,
  formatMarkdownAcceptanceCriteria,
  formatMarkdownComment,
  toCommentDetails,
  toIssueDetails,
} from "./issue";
export {
  buildSprintReviewMetrics,
  buildSprintReviewSnapshot,
  buildSprintReviewSnapshotForSprint,
  buildTeamVelocitySeries,
  calculateSprintEstimates,
  extractIssueEstimate,
  filterCommittedIssues,
  getActiveSprintID,
  getTeamVelocity,
  normalizeSprintKeyList,
} from "./sprint-report";

export function createJiraClient(env: Record<string, string | undefined> = process.env): JiraClient {
  const config = createJiraClientConfig(env);

  const getIssue = async (issueKey: string): Promise<JiraIssueDetails> => {
    const key = normalizeIssueKey(issueKey);
    const issue = await requestJira<{
      id: string;
      key: string;
      fields?: {
        summary?: string;
        description?: string;
        status?: { name?: string };
        priority?: { name?: string };
        labels?: string[];
        issuetype?: { name?: string };
      };
    }>(
      config,
      "GET",
      `rest/api/${config.apiVersion}/issue/${key}?fields=summary,description,status,priority,labels,issuetype`
    );
    return toIssueDetails(config.baseUrl, issue);
  };

  const updateIssue = async (input: JiraUpdateIssueInput): Promise<JiraIssueDetails> => {
    const issueKey = normalizeIssueKey(input.issueKey);
    await requestJira<void>(config, "PUT", `rest/api/${config.apiVersion}/issue/${issueKey}`, buildUpdateIssuePayload(input));
    return await getIssue(issueKey);
  };

  const addComment = async (input: JiraCommentInput): Promise<JiraCommentDetails> => {
    const issueKey = normalizeIssueKey(input.issueKey);
    const comment = await requestJira<{ id: string; body?: string; created?: string }>(
      config,
      "POST",
      `rest/api/${config.apiVersion}/issue/${issueKey}/comment`,
      buildCommentPayload(input.comment)
    );
    return toCommentDetails(config.baseUrl, issueKey, comment);
  };

  const getSprintReviewSnapshot = async (projectKey: string, boardId?: string | number): Promise<JiraSprintReviewSnapshot> => {
    return await buildSprintReviewSnapshot(config, projectKey, boardId);
  };

  const getTeamVelocitySnapshot = async (
    projectKey: string,
    boardId?: string | number,
    windowSize = 5,
    includeAddedDuringSprint = false
  ): Promise<TeamVelocitySeries> => {
    return await getTeamVelocity(config, projectKey, boardId, windowSize, includeAddedDuringSprint);
  };

  return {
    async createIssue(input: JiraCreateIssueInput): Promise<JiraIssueDetails> {
      const response = await requestJira<{ id: string; key: string }>(config, "POST", `rest/api/${config.apiVersion}/issue`, buildCreateIssuePayload(input, config));
      return await getIssue(response.key);
    },
    getIssue,
    updateIssue,
    addComment,
    getSprintReviewSnapshot,
    getTeamVelocity: getTeamVelocitySnapshot,
  };
}

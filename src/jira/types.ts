export type JiraEnv = Record<string, string | undefined>;

export type JiraClientConfig = {
  baseUrl: string;
  headers: Record<string, string>;
  projectKey?: string;
  email?: string;
  boardId?: string;
  issueTypeId: string;
  apiVersion: string;
  acceptanceCriteriaField?: string;
  cancelledStatuses: string[];
  almostDoneStatuses: string[];
  notStartedStatuses: string[];
};

export type JiraIssueDetails = {
  id: string;
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string | null;
  priority: string | null;
  issueType: string | null;
  labels: string[];
};

export type JiraCommentDetails = {
  id: string;
  body: string;
  created: string | null;
  url: string;
};

export type JiraBoardDetails = {
  id: string;
  self: string | null;
  name: string;
  type: string | null;
  projectKey: string | null;
  projectName: string | null;
  projectType: string | null;
};

export type JiraSprintDetails = {
  id: string;
  self: string | null;
  name: string;
  state: string | null;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  activatedDate: string | null;
  goal: string | string[] | null;
  originBoardId: string | null;
};

export type JiraSprintReviewIssue = {
  key: string;
  summary: string;
  status: string | null;
  issueType: string | null;
  priority: string | null;
  estimate: number | null;
  statusCategory: "new" | "indeterminate" | "done" | null;
};

export type JiraSprintEstimateStatistics = {
  statFieldId: string | null;
  sum: number | null;
  completedSum: number | null;
};

export type JiraSprintReviewMetrics = {
  completedIssueCount: number;
  notCompletedIssueCount: number;
  puntedIssueCount: number;
  completedInAnotherSprintIssueCount: number;
  totalIssueCount: number;
  addedDuringSprintCount: number;
  removedDuringSprintCount: number;
  statusCounts: Record<string, number>;
  estimateStatistics: JiraSprintEstimateStatistics | null;
};

export type JiraSprintReviewSnapshot = {
  projectKey: string;
  boardId: string;
  board: JiraBoardDetails;
  sprint: JiraSprintDetails;
  metrics: JiraSprintReviewMetrics;
  completedIssues: JiraSprintReviewIssue[];
  notCompletedIssues: JiraSprintReviewIssue[];
  puntedIssues: JiraSprintReviewIssue[];
  completedInAnotherSprintIssues: JiraSprintReviewIssue[];
  issueKeysAddedDuringSprint: string[];
  issueKeysRemovedDuringSprint: string[];
};

export type SprintEstimateSummary = {
  completedPoints: number | null;
  committedPoints: number | null;
  remainingPoints: number | null;
  reliabilityPercent: number | null;
  missingEstimateIssueCount: number;
};

export type TeamVelocityPoint = {
  sprintId: string;
  sprintName: string;
  startDate: string | null;
  endDate: string | null;
  completedPoints: number | null;
  committedPoints: number | null;
  reliabilityPercent: number | null;
  includeAddedDuringSprint: boolean;
};

export type TeamVelocitySeries = {
  boardId: string;
  windowSize: number;
  includeAddedDuringSprint: boolean;
  averageCompletedPoints: number | null;
  averageCommittedPoints: number | null;
  reliabilityPercent: number | null;
  points: TeamVelocityPoint[];
};

export type JiraCreateIssueInput = {
  issueType?: string;
  issueTypeId?: string;
  summary: string;
  description?: string;
  acceptanceCriteria?: string;
};

export type JiraUpdateIssueInput = {
  issueKey: string;
  summary?: string;
  description?: string;
  labels?: string[];
  priority?: string;
};

export type JiraCommentInput = {
  issueKey: string;
  comment: string;
};

export type JiraClient = {
  createIssue(input: JiraCreateIssueInput): Promise<JiraIssueDetails>;
  getIssue(issueKey: string): Promise<JiraIssueDetails>;
  updateIssue(input: JiraUpdateIssueInput): Promise<JiraIssueDetails>;
  addComment(input: JiraCommentInput): Promise<JiraCommentDetails>;
  getSprintReviewSnapshot(projectKey: string, boardId?: string | number): Promise<JiraSprintReviewSnapshot>;
  getTeamVelocity(
    projectKey: string,
    boardId?: string | number,
    windowSize?: number,
    includeAddedDuringSprint?: boolean
  ): Promise<TeamVelocitySeries>;
};

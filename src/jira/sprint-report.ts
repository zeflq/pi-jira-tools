import type {
  JiraBoardDetails,
  JiraClientConfig,
  JiraSprintDetails,
  JiraSprintEstimateStatistics,
  JiraSprintReviewIssue,
  JiraSprintReviewMetrics,
  JiraSprintReviewSnapshot,
  SprintEstimateSummary,
  TeamVelocitySeries,
} from "./types";
import { normalizeBoardId, normalizeIssueKey, normalizeProjectKey } from "./env";
import { requestJira } from "./http";

type JiraBoardResponse = {
  id: string | number;
  self?: string;
  name?: string;
  type?: string;
  location?: { projectKey?: string; projectName?: string; type?: string };
};

type JiraSprintResponse = {
  id: string | number;
  self?: string;
  state?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  activatedDate?: string;
  goal?: string | string[];
  originBoardId?: string | number;
};

type JiraSprintListResponse = {
  maxResults?: number;
  startAt?: number;
  isLast?: boolean;
  values?: JiraSprintResponse[];
};

type JiraSprintEntityStatusResponse = {
  statusName?: string;
  name?: string;
  statusCategory?: { key?: string };
};

type JiraSprintEntityTypeResponse = {
  typeName?: string;
  name?: string;
};

type JiraSprintEntityPriorityResponse = {
  priorityName?: string;
  name?: string;
};

type JiraSprintReportEntityDataResponse = {
  statuses?: Record<string, JiraSprintEntityStatusResponse>;
  types?: Record<string, JiraSprintEntityTypeResponse>;
  priorities?: Record<string, JiraSprintEntityPriorityResponse>;
};

type JiraSprintStatisticValueResponse = {
  value?: number;
  text?: string;
};

type JiraSprintIssueEstimateStatisticResponse = {
  statFieldId?: string;
  statFieldValue?: JiraSprintStatisticValueResponse;
};

type JiraSprintReportIssueResponse = {
  key: string;
  summary?: string;
  statusId?: string | number;
  statusName?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  typeId?: string | number;
  typeName?: string;
  issueTypeName?: string;
  type?: string;
  priorityId?: string | number;
  priorityName?: string;
  priority?: { name?: string };
  estimateStatistic?: JiraSprintIssueEstimateStatisticResponse;
  currentEstimateStatistic?: JiraSprintIssueEstimateStatisticResponse;
};

type JiraSprintEstimateStatisticsResponse = {
  statFieldId?: string;
  sum?: { value?: number; text?: string };
  completedSum?: { value?: number; text?: string };
};

type JiraSprintKeyListResponse = string[] | Record<string, unknown> | undefined;

type JiraSprintReportContentsResponse = {
  completedIssues?: JiraSprintReportIssueResponse[];
  issuesNotCompletedInCurrentSprint?: JiraSprintReportIssueResponse[];
  puntedIssues?: JiraSprintReportIssueResponse[];
  issuesCompletedInAnotherSprint?: JiraSprintReportIssueResponse[];
  issueKeysAddedDuringSprint?: JiraSprintKeyListResponse;
  issueKeysRemovedDuringSprint?: JiraSprintKeyListResponse;
  issueEstimateStatistics?: JiraSprintEstimateStatisticsResponse;
  entityData?: JiraSprintReportEntityDataResponse;
};

type JiraSprintReportSprintResponse = JiraSprintResponse & {
  isoStartDate?: string;
  isoEndDate?: string;
  isoCompleteDate?: string;
};

type JiraSprintReportResponse = {
  sprint?: JiraSprintReportSprintResponse;
  contents?: JiraSprintReportContentsResponse;
};

type BoardResolution = {
  normalizedProjectKey: string;
  normalizedBoardId: string;
  board: JiraBoardDetails;
};

function normalizeEntityKey(value: string | number | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveEntityName(
  id: string | number | undefined,
  entityMap: Record<string, { name?: string; statusName?: string; typeName?: string; priorityName?: string }> | undefined,
  directName: string | undefined,
  fallbackName: string | undefined
): string | null {
  const normalizedDirectName = directName?.trim();
  if (normalizedDirectName) {
    return normalizedDirectName;
  }

  const normalizedFallbackName = fallbackName?.trim();
  if (normalizedFallbackName) {
    return normalizedFallbackName;
  }

  const normalizedId = normalizeEntityKey(id);
  if (!normalizedId || !entityMap) {
    return null;
  }

  const entry = entityMap[normalizedId];
  if (!entry) {
    return null;
  }

  return entry.name?.trim() || entry.statusName?.trim() || entry.typeName?.trim() || entry.priorityName?.trim() || null;
}

function toBoardDetails(board: JiraBoardResponse): JiraBoardDetails {
  return {
    id: String(board.id),
    self: board.self ?? null,
    name: board.name?.trim() ?? "",
    type: board.type ?? null,
    projectKey: board.location?.projectKey?.trim().toUpperCase() ?? null,
    projectName: board.location?.projectName?.trim() ?? null,
    projectType: board.location?.type?.trim() ?? null,
  };
}

function toSprintDetails(sprint: JiraSprintResponse): JiraSprintDetails {
  return {
    id: String(sprint.id),
    self: sprint.self ?? null,
    name: sprint.name?.trim() ?? "",
    state: sprint.state ?? null,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    completeDate: sprint.completeDate ?? null,
    activatedDate: sprint.activatedDate ?? null,
    goal: sprint.goal ?? null,
    originBoardId: sprint.originBoardId !== undefined ? String(sprint.originBoardId) : null,
  };
}

function resolveIssueEstimate(issue: JiraSprintReportIssueResponse): number | null {
  const directEstimate = issue.estimateStatistic?.statFieldValue?.value;
  if (directEstimate !== undefined && directEstimate !== null) {
    return directEstimate;
  }
  const currentEstimate = issue.currentEstimateStatistic?.statFieldValue?.value;
  if (currentEstimate !== undefined && currentEstimate !== null) {
    return currentEstimate;
  }

  return null;
}

function toSprintReviewIssue(
  issue: JiraSprintReportIssueResponse,
  entityData: JiraSprintReportEntityDataResponse | undefined
): JiraSprintReviewIssue {
  return {
    key: normalizeIssueKey(issue.key),
    summary: issue.summary?.trim() ?? "",
    status: resolveEntityName(issue.statusId, entityData?.statuses, issue.statusName, issue.status?.name),
    issueType: resolveEntityName(issue.typeId, entityData?.types, issue.typeName ?? issue.issueTypeName, issue.type),
    priority: resolveEntityName(issue.priorityId, entityData?.priorities, issue.priorityName, issue.priority?.name),
    estimate: resolveIssueEstimate(issue),
    statusCategory: toStatusCategory(
      issue.status?.statusCategory?.key ?? entityData?.statuses?.[normalizeEntityKey(issue.statusId) ?? ""]?.statusCategory?.key
    ),
  };
}

function toStatusCategory(key: string | undefined): JiraSprintReviewIssue["statusCategory"] {
  return key === "new" || key === "indeterminate" || key === "done" ? key : null;
}

// Compares status names ignoring case, repeated spaces and non-breaking spaces.
function normalizeStatusName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function matchesStatus(issue: JiraSprintReviewIssue, statuses: string[]): boolean {
  if (!issue.status) {
    return false;
  }
  const status = normalizeStatusName(issue.status);
  return statuses.some((candidate) => normalizeStatusName(candidate) === status);
}

// A 0-point estimate marks a parent ticket: its points live on the child tickets.
export function isParentIssue(issue: JiraSprintReviewIssue): boolean {
  return issue.estimate === 0;
}

export function percent(part: number | null, total: number | null): number | null {
  if (part === null || total === null || total <= 0) {
    return null;
  }
  return Math.round((part / total) * 1000) / 10;
}

function toEstimateStatistics(stats: JiraSprintEstimateStatisticsResponse | undefined): JiraSprintEstimateStatistics | null {
  if (!stats) {
    return null;
  }

  return {
    statFieldId: stats.statFieldId?.trim() ?? null,
    sum: stats.sum?.value ?? null,
    completedSum: stats.completedSum?.value ?? null,
  };
}

function buildStatusCounts(issues: JiraSprintReviewIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    const status = issue.status?.trim() || "Unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export function extractIssueEstimate(issue: JiraSprintReviewIssue): number | null {
  return issue.estimate ?? null;
}

export function normalizeSprintKeyList(value: JiraSprintKeyListResponse): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeIssueKey(item)).filter((item) => item.length > 0);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.keys(value)
    .map((item) => normalizeIssueKey(item))
    .filter((item) => item.length > 0);
}

export function filterCommittedIssues(
  issues: JiraSprintReviewIssue[],
  addedIssueKeys: string[],
  includeAddedDuringSprint: boolean
): JiraSprintReviewIssue[] {
  if (includeAddedDuringSprint) {
    return [...issues];
  }

  const addedIssueKeySet = new Set(addedIssueKeys);
  return issues.filter((issue) => !addedIssueKeySet.has(issue.key));
}

function sumIssuePoints(issues: JiraSprintReviewIssue[]): { points: number | null; missingEstimateIssueCount: number } {
  let total = 0;
  let seenValue = false;
  let missingEstimateIssueCount = 0;

  for (const issue of issues) {
    const estimate = extractIssueEstimate(issue);
    if (estimate === null) {
      missingEstimateIssueCount += 1;
      continue;
    }

    total += estimate;
    seenValue = true;
  }

  return {
    points: seenValue ? total : null,
    missingEstimateIssueCount,
  };
}

export function calculateSprintEstimates(
  snapshot: JiraSprintReviewSnapshot,
  includeAddedDuringSprint: boolean,
  cancelledStatuses: string[] = []
): SprintEstimateSummary {
  const isCounted = (issue: JiraSprintReviewIssue) => !isParentIssue(issue) && !matchesStatus(issue, cancelledStatuses);
  const committedIssues = filterCommittedIssues(
    [...snapshot.completedIssues, ...snapshot.notCompletedIssues, ...snapshot.puntedIssues],
    snapshot.issueKeysAddedDuringSprint,
    includeAddedDuringSprint
  ).filter(isCounted);
  const completedIssues = filterCommittedIssues(snapshot.completedIssues, snapshot.issueKeysAddedDuringSprint, includeAddedDuringSprint).filter(
    isCounted
  );

  const completedEstimate = sumIssuePoints(completedIssues);
  const committedEstimate = sumIssuePoints(committedIssues);
  const completedPoints = completedEstimate.points;
  const committedPoints = committedEstimate.points;
  const remainingPoints =
    completedPoints !== null && committedPoints !== null ? Math.max(committedPoints - completedPoints, 0) : null;
  const reliabilityPercent = percent(completedPoints, committedPoints);

  return {
    completedPoints,
    committedPoints,
    remainingPoints,
    reliabilityPercent,
    missingEstimateIssueCount: committedEstimate.missingEstimateIssueCount,
  };
}

export function buildSprintReviewMetrics(contents: JiraSprintReportContentsResponse | undefined): JiraSprintReviewMetrics {
  const entityData = contents?.entityData;
  const completedIssues = (contents?.completedIssues ?? []).map((issue) => toSprintReviewIssue(issue, entityData));
  const notCompletedIssues = (contents?.issuesNotCompletedInCurrentSprint ?? []).map((issue) => toSprintReviewIssue(issue, entityData));
  const puntedIssues = (contents?.puntedIssues ?? []).map((issue) => toSprintReviewIssue(issue, entityData));
  const completedInAnotherSprintIssues = (contents?.issuesCompletedInAnotherSprint ?? []).map((issue) => toSprintReviewIssue(issue, entityData));
  const allIssues = [...completedIssues, ...notCompletedIssues, ...puntedIssues, ...completedInAnotherSprintIssues];
  const issueKeysAddedDuringSprint = normalizeSprintKeyList(contents?.issueKeysAddedDuringSprint);
  const issueKeysRemovedDuringSprint = normalizeSprintKeyList(contents?.issueKeysRemovedDuringSprint);

  return {
    completedIssueCount: completedIssues.length,
    notCompletedIssueCount: notCompletedIssues.length,
    puntedIssueCount: puntedIssues.length,
    completedInAnotherSprintIssueCount: completedInAnotherSprintIssues.length,
    totalIssueCount: allIssues.length,
    addedDuringSprintCount: issueKeysAddedDuringSprint.length,
    removedDuringSprintCount: issueKeysRemovedDuringSprint.length,
    statusCounts: buildStatusCounts(allIssues),
    estimateStatistics: toEstimateStatistics(contents?.issueEstimateStatistics),
  };
}

export async function getActiveSprintID(config: JiraClientConfig, boardId: string | number): Promise<string> {
  const normalizedBoardId = normalizeBoardId(boardId);
  const sprintList = (await requestJira<JiraSprintListResponse>(
    config,
    "GET",
    `rest/agile/1.0/board/${normalizedBoardId}/sprint?state=active`
  )) ?? { values: [] };

  const activeSprint = sprintList.values?.[0];
  if (!activeSprint) {
    throw new Error(`No active sprint found for board ${normalizedBoardId}.`);
  }

  return String(activeSprint.id);
}

async function listBoardSprints(config: JiraClientConfig, boardId: string, state: string): Promise<JiraSprintResponse[]> {
  const sprints: JiraSprintResponse[] = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const page = (await requestJira<JiraSprintListResponse>(
      config,
      "GET",
      `rest/agile/1.0/board/${boardId}/sprint?state=${state}&startAt=${startAt}&maxResults=${maxResults}`
    )) ?? { values: [] };

    const values = page.values ?? [];
    sprints.push(...values);

    if (page.isLast ?? values.length < maxResults) {
      break;
    }

    if (values.length === 0) {
      break;
    }

    startAt += values.length;
  }

  return sprints;
}

function resolveSprintReviewBoardId(boardId: string | number | undefined, defaultBoardId: string | undefined): string {
  if (boardId !== undefined) {
    return normalizeBoardId(boardId);
  }

  if (defaultBoardId !== undefined) {
    return normalizeBoardId(defaultBoardId);
  }

  throw new Error("Provide a boardId or configure JIRA_BOARD_ID for sprint review.");
}

async function resolveBoard(config: JiraClientConfig, projectKey: string, boardId?: string | number): Promise<BoardResolution> {
  const normalizedProjectKey = normalizeProjectKey(projectKey);
  const normalizedBoardId = resolveSprintReviewBoardId(boardId, config.boardId);

  const board = await requestJira<JiraBoardResponse>(config, "GET", `rest/agile/1.0/board/${normalizedBoardId}`);
  if (!board) {
    throw new Error(`Board ${normalizedBoardId} did not return any data.`);
  }

  const boardDetails = toBoardDetails(board);
  if (boardDetails.projectKey && boardDetails.projectKey !== normalizedProjectKey) {
    throw new Error(
      `Board ${normalizedBoardId} belongs to project ${boardDetails.projectKey}, not ${normalizedProjectKey}.`
    );
  }

  return {
    normalizedProjectKey,
    normalizedBoardId,
    board: boardDetails,
  };
}

async function fetchSprintReport(config: JiraClientConfig, boardId: string, sprintId: string): Promise<JiraSprintReportResponse> {
  const report = await requestJira<JiraSprintReportResponse>(
    config,
    "GET",
    `rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprintId}`
  );
  if (!report) {
    throw new Error(`Sprint report for sprint ${sprintId} did not return any data.`);
  }
  return report;
}

function toIsoDate(value: string | undefined): string | undefined {
  return value && value !== "None" ? value : undefined;
}

// The sprint report returns display dates ("17/Oct/26 7:00 PM") plus ISO copies, and "None" for missing dates.
function normalizeReportSprint(sprint: JiraSprintReportSprintResponse | undefined): JiraSprintResponse {
  if (!sprint) {
    return {} as JiraSprintResponse;
  }

  const { isoStartDate, isoEndDate, isoCompleteDate, ...rest } = sprint;
  const normalized: JiraSprintResponse = { ...rest };
  for (const [field, iso] of [
    ["startDate", isoStartDate],
    ["endDate", isoEndDate],
    ["completeDate", isoCompleteDate],
  ] as const) {
    const value = toIsoDate(iso) ?? toIsoDate(rest[field]);
    if (value === undefined) {
      delete normalized[field];
    } else {
      normalized[field] = value;
    }
  }
  return normalized;
}

function toSnapshot(resolution: BoardResolution, sprint: JiraSprintResponse, report: JiraSprintReportResponse): JiraSprintReviewSnapshot {
  const contents = report.contents;
  const entityData = contents?.entityData;
  const mapIssues = (issues: JiraSprintReportIssueResponse[] | undefined) => (issues ?? []).map((issue) => toSprintReviewIssue(issue, entityData));

  return {
    projectKey: resolution.normalizedProjectKey,
    boardId: resolution.normalizedBoardId,
    board: resolution.board,
    sprint: toSprintDetails({ ...sprint, ...normalizeReportSprint(report.sprint), id: report.sprint?.id ?? sprint.id }),
    metrics: buildSprintReviewMetrics(contents),
    completedIssues: mapIssues(contents?.completedIssues),
    notCompletedIssues: mapIssues(contents?.issuesNotCompletedInCurrentSprint),
    puntedIssues: mapIssues(contents?.puntedIssues),
    completedInAnotherSprintIssues: mapIssues(contents?.issuesCompletedInAnotherSprint),
    issueKeysAddedDuringSprint: normalizeSprintKeyList(contents?.issueKeysAddedDuringSprint),
    issueKeysRemovedDuringSprint: normalizeSprintKeyList(contents?.issueKeysRemovedDuringSprint),
  };
}

export async function buildSprintReviewSnapshotForSprint(
  config: JiraClientConfig,
  resolution: BoardResolution,
  sprint: JiraSprintResponse
): Promise<JiraSprintReviewSnapshot> {
  const report = await fetchSprintReport(config, resolution.normalizedBoardId, String(sprint.id));
  return toSnapshot(resolution, sprint, report);
}

export async function buildSprintReviewSnapshot(
  config: JiraClientConfig,
  projectKey: string,
  boardId?: string | number
): Promise<JiraSprintReviewSnapshot> {
  const resolution = await resolveBoard(config, projectKey, boardId);
  const sprintId = await getActiveSprintID(config, resolution.normalizedBoardId);
  return await buildSprintReviewSnapshotForSprint(config, resolution, { id: sprintId });
}

// Planned end date first: a sprint closed late (or several closed the same day) keeps its chronological place.
function sprintSortKey(sprint: JiraSprintResponse): number {
  const date = sprint.endDate ?? sprint.completeDate ?? sprint.startDate;
  const time = date ? new Date(date).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function buildTeamVelocitySeries(
  boardId: string,
  windowSize: number,
  includeAddedDuringSprint: boolean,
  snapshots: JiraSprintReviewSnapshot[],
  cancelledStatuses: string[] = []
): TeamVelocitySeries {
  const points = snapshots.map((snapshot) => {
    const estimates = calculateSprintEstimates(snapshot, includeAddedDuringSprint, cancelledStatuses);
    return {
      sprintId: snapshot.sprint.id,
      sprintName: snapshot.sprint.name,
      startDate: snapshot.sprint.startDate,
      endDate: snapshot.sprint.endDate,
      completedPoints: estimates.completedPoints,
      committedPoints: estimates.committedPoints,
      reliabilityPercent: estimates.reliabilityPercent,
      includeAddedDuringSprint,
    };
  });

  const completed = points.map((point) => point.completedPoints).filter((value): value is number => value !== null);
  const committed = points.map((point) => point.committedPoints).filter((value): value is number => value !== null);
  // Reliability is total completed / total committed, so bigger sprints weigh more than small ones.
  const measured = points.filter((point) => point.completedPoints !== null && point.committedPoints !== null);
  const totalCompleted = measured.reduce((sum, point) => sum + (point.completedPoints ?? 0), 0);
  const totalCommitted = measured.reduce((sum, point) => sum + (point.committedPoints ?? 0), 0);

  return {
    boardId,
    windowSize,
    includeAddedDuringSprint,
    averageCompletedPoints: average(completed),
    averageCommittedPoints: average(committed),
    reliabilityPercent: measured.length > 0 ? percent(totalCompleted, totalCommitted) : null,
    points,
  };
}

export async function getTeamVelocity(
  config: JiraClientConfig,
  projectKey: string,
  boardId?: string | number,
  windowSize = 5,
  includeAddedDuringSprint = false
): Promise<TeamVelocitySeries> {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error(`Invalid team velocity window size: ${windowSize}`);
  }

  const resolution = await resolveBoard(config, projectKey, boardId);
  const closedSprints = await listBoardSprints(config, resolution.normalizedBoardId, "closed");
  const recentSprints = closedSprints
    .filter((sprint) => sprint.originBoardId === undefined || String(sprint.originBoardId) === resolution.normalizedBoardId)
    .sort((left, right) => sprintSortKey(left) - sprintSortKey(right))
    .slice(-windowSize);

  const snapshots: JiraSprintReviewSnapshot[] = [];
  for (const sprint of recentSprints) {
    snapshots.push(await buildSprintReviewSnapshotForSprint(config, resolution, sprint));
  }

  return buildTeamVelocitySeries(resolution.normalizedBoardId, windowSize, includeAddedDuringSprint, snapshots, config.cancelledStatuses);
}

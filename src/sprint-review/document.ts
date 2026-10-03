import type { JiraSprintReviewIssue, JiraSprintReviewSnapshot, TeamVelocitySeries } from "../jira/types";
import { calculateSprintEstimates, isParentIssue, matchesStatus, percent } from "../jira/sprint-report";
import { formatSprintDate, normalizeSprintGoal } from "./formatters";

export type SprintGoalStatus = "achieved" | "partial" | "missed";
export type GoalItemStatus = "achieved" | "partial" | "not_achieved" | "unclear";
export type SlippedBucket = "almost_done" | "in_progress" | "not_started";

export type GoalConfidence = "high" | "medium" | "low";

export type GoalAssessment = {
  text: string;
  status: GoalItemStatus;
  source: "rule" | "llm";
  confidence?: GoalConfidence;
  evidence?: string[];
  rationale?: string;
};

// Filled by the optional LLM step; null when it did not run or failed. Numbers never come from here.
export type SprintReviewAssessment = {
  model: string;
  summary: string;
  // True when the team rules file (.pi/sprint-review-rules.md) was part of the prompt.
  teamRules: boolean;
  goals: Array<{ goal: string; status: GoalItemStatus; confidence: GoalConfidence; evidence: string[]; rationale: string }>;
};

export type SprintIssue = JiraSprintReviewIssue & {
  bucket?: SlippedBucket;
};

export type SprintReviewOptions = {
  includeAddedDuringSprint: boolean;
  cancelledStatuses: string[];
  almostDoneStatuses: string[];
  notStartedStatuses?: string[];
  now?: Date;
};

// One schema for every output: the CLI summary, the HTML deck and the pi session entry all read it.
export type SprintReviewDocument = {
  header: {
    projectKey: string;
    boardId: string;
    boardName: string;
    sprint: {
      id: string;
      name: string;
      state: string | null;
      startDate: string;
      endDate: string;
      goals: string[];
    };
    includeAddedDuringSprint: boolean;
  };
  goal: {
    status: SprintGoalStatus;
    goals: GoalAssessment[];
    ticketsDone: number;
    ticketsTotal: number;
    cancelledCount: number;
    pointsDone: number | null;
    pointsCommitted: number | null;
    pointsPercent: number | null;
    averageReliabilityPercent: number | null;
    daysLeft: number | null;
  };
  delivered: {
    tickets: number;
    points: number | null;
    deltaVsAverage: number | null;
    cancelledCount: number;
    doneElsewhereCount: number;
    issues: SprintIssue[];
  };
  slipped: {
    remainingPoints: number | null;
    almostDone: number;
    inProgress: number;
    notStarted: number;
    unestimated: number;
    almostDoneStatuses: string[];
    addedDuringSprint: number;
    removedDuringSprint: number;
    issues: SprintIssue[];
    punted: SprintIssue[];
  };
  trend: {
    windowSize: number;
    averageCompleted: number | null;
    averageCommitted: number | null;
    reliabilityPercent: number | null;
    currentReliabilityPercent: number | null;
    sprints: Array<{
      name: string;
      completed: number | null;
      committed: number | null;
      reliabilityPercent: number | null;
    }>;
  };
  assessment: SprintReviewAssessment | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Counts Monday–Friday days in (from, to], comparing calendar days only.
export function countWorkingDays(from: Date, to: Date): number {
  let count = 0;
  for (let day = toUtcDay(from) + DAY_MS; day <= toUtcDay(to); day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      count += 1;
    }
  }
  return count;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function byKey(left: JiraSprintReviewIssue, right: JiraSprintReviewIssue): number {
  return left.key.localeCompare(right.key);
}

function toBucket(issue: JiraSprintReviewIssue, options: SprintReviewOptions): SlippedBucket {
  if (matchesStatus(issue, options.almostDoneStatuses)) {
    return "almost_done";
  }
  if (issue.statusCategory !== null) {
    return issue.statusCategory === "new" ? "not_started" : "in_progress";
  }
  // No category from Jira: fall back to the configured "not started" status names.
  return matchesStatus(issue, options.notStartedStatuses ?? []) ? "not_started" : "in_progress";
}

// Achieved when every counted ticket is done, partially achieved from 50% of points (or tickets), missed below.
function resolveGoalStatus(input: { ticketsDone: number; ticketsTotal: number; progressPercent: number | null }): SprintGoalStatus {
  if (input.ticketsTotal > 0 && input.ticketsDone === input.ticketsTotal) {
    return "achieved";
  }
  return (input.progressPercent ?? 0) >= 50 ? "partial" : "missed";
}

function toGoalItemStatus(status: SprintGoalStatus): GoalItemStatus {
  if (status === "achieved") {
    return "achieved";
  }
  if (status === "missed") {
    return "not_achieved";
  }
  // Without the LLM, nothing links a ticket to a goal, so individual goals stay unjudged.
  return "unclear";
}

export function buildSprintReviewDocument(
  snapshot: JiraSprintReviewSnapshot,
  teamVelocity: TeamVelocitySeries,
  options: SprintReviewOptions
): SprintReviewDocument {
  const now = options.now ?? new Date();
  const isCancelled = (issue: JiraSprintReviewIssue) => matchesStatus(issue, options.cancelledStatuses);
  const isChild = (issue: JiraSprintReviewIssue) => !isParentIssue(issue);

  const doneIssues = snapshot.completedIssues.filter((issue) => isChild(issue) && !isCancelled(issue)).sort(byKey);
  const openIssues = snapshot.notCompletedIssues.filter((issue) => isChild(issue) && !isCancelled(issue)).sort(byKey);
  const cancelledCount = [...snapshot.completedIssues, ...snapshot.notCompletedIssues].filter(
    (issue) => isChild(issue) && isCancelled(issue)
  ).length;
  const ticketsDone = doneIssues.length;
  const ticketsTotal = doneIssues.length + openIssues.length;

  const estimates = calculateSprintEstimates(snapshot, options.includeAddedDuringSprint, options.cancelledStatuses);
  const pointsPercent = percent(estimates.completedPoints, estimates.committedPoints);

  const state = snapshot.sprint.state?.toLowerCase() ?? null;
  const isClosed = state === "closed" || snapshot.sprint.completeDate !== null;
  const endDate = parseDate(snapshot.sprint.endDate);
  const daysLeft = isClosed || !endDate ? null : countWorkingDays(now, endDate);

  const goalStatus = resolveGoalStatus({
    ticketsDone,
    ticketsTotal,
    progressPercent: pointsPercent ?? percent(ticketsDone, ticketsTotal),
  });
  const goals = normalizeSprintGoal(snapshot.sprint.goal);

  const slippedIssues: SprintIssue[] = openIssues.map((issue) => ({ ...issue, bucket: toBucket(issue, options) }));
  const countBucket = (bucket: SlippedBucket) => slippedIssues.filter((issue) => issue.bucket === bucket).length;
  const averageCompleted = teamVelocity.averageCompletedPoints;

  return {
    header: {
      projectKey: snapshot.projectKey,
      boardId: snapshot.boardId,
      boardName: snapshot.board.name,
      sprint: {
        id: snapshot.sprint.id,
        name: snapshot.sprint.name,
        state,
        startDate: formatSprintDate(snapshot.sprint.startDate),
        endDate: formatSprintDate(snapshot.sprint.endDate),
        goals,
      },
      includeAddedDuringSprint: options.includeAddedDuringSprint,
    },
    goal: {
      status: goalStatus,
      goals: goals.map((text) => ({ text, status: toGoalItemStatus(goalStatus), source: "rule" })),
      ticketsDone,
      ticketsTotal,
      cancelledCount,
      pointsDone: estimates.completedPoints,
      pointsCommitted: estimates.committedPoints,
      pointsPercent,
      averageReliabilityPercent: teamVelocity.reliabilityPercent,
      daysLeft,
    },
    delivered: {
      tickets: ticketsDone,
      points: estimates.completedPoints,
      deltaVsAverage:
        estimates.completedPoints !== null && averageCompleted !== null
          ? Math.round((estimates.completedPoints - averageCompleted) * 10) / 10
          : null,
      cancelledCount,
      doneElsewhereCount: snapshot.completedInAnotherSprintIssues.length,
      issues: doneIssues,
    },
    slipped: {
      remainingPoints: estimates.remainingPoints,
      almostDone: countBucket("almost_done"),
      inProgress: countBucket("in_progress"),
      notStarted: countBucket("not_started"),
      unestimated: openIssues.filter((issue) => issue.estimate === null).length,
      almostDoneStatuses: options.almostDoneStatuses,
      addedDuringSprint: snapshot.issueKeysAddedDuringSprint.length,
      removedDuringSprint: snapshot.issueKeysRemovedDuringSprint.length,
      issues: slippedIssues,
      punted: [...snapshot.puntedIssues].sort(byKey),
    },
    trend: {
      windowSize: teamVelocity.windowSize,
      averageCompleted,
      averageCommitted: teamVelocity.averageCommittedPoints,
      reliabilityPercent: teamVelocity.reliabilityPercent,
      currentReliabilityPercent: pointsPercent,
      sprints: teamVelocity.points.map((point) => ({
        name: point.sprintName,
        completed: point.completedPoints,
        committed: point.committedPoints,
        reliabilityPercent: point.reliabilityPercent,
      })),
    },
    assessment: null,
  };
}

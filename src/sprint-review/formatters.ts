import type { JiraSprintReviewIssue } from "../jira/types";
import type { GoalAssessment, GoalItemStatus, SprintGoalStatus, SprintReviewDocument } from "./document";

export function normalizeSprintGoal(goal: string | string[] | null | undefined): string[] {
  const values = Array.isArray(goal) ? goal : goal === null || goal === undefined ? [] : [goal];
  return values
    .flatMap((value) => String(value).split(/\r?\n/))
    .map((part) => part.replace(/^-+\s*/, "").trim())
    .filter((part) => part.length > 0);
}

export function formatSprintDate(date: string | null | undefined): string {
  if (!date) {
    return "n/a";
  }

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "n/a";
  }

  return parsedDate.toISOString().slice(0, 10);
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(value);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${value}%`;
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "±0";
}

const GOAL_STATUS_LABELS: Record<SprintGoalStatus, string> = {
  achieved: "Achieved",
  partial: "Partially achieved",
  missed: "Missed",
};

export function formatGoalStatus(status: SprintGoalStatus): string {
  return GOAL_STATUS_LABELS[status];
}

export function formatPoints(value: number | null): string {
  return value === null ? "n/a" : `${value} pts`;
}

export function formatIssueLine(issue: JiraSprintReviewIssue): string {
  const details = [issue.issueType ?? "n/a", issue.status ?? "n/a", issue.priority ?? "n/a"].join(", ");
  return `- ${issue.key} — ${issue.summary} (${details}) · ${formatPoints(issue.estimate)}`;
}

function formatIssueList(issues: JiraSprintReviewIssue[]): string[] {
  return issues.length === 0 ? ["- none"] : issues.map(formatIssueLine);
}

// Card text shared by the CLI and the HTML deck, so both always word the numbers the same way.
export function buildSummaryLines(document: SprintReviewDocument) {
  const { goal, delivered, slipped, trend } = document;
  return {
    goalStatus: formatGoalStatus(goal.status),
    ticketsDone: `${goal.ticketsDone} / ${goal.ticketsTotal}`,
    cancelled: `+${goal.cancelledCount} cancelled`,
    pointsDelivered:
      goal.pointsDone !== null && goal.pointsCommitted !== null
        ? `${goal.pointsDone} / ${goal.pointsCommitted} (${formatPercent(goal.pointsPercent)})`
        : "n/a",
    averageReliability: `average ${formatPercent(goal.averageReliabilityPercent)}`,
    daysLeft: goal.daysLeft === null ? "Ended" : String(goal.daysLeft),
    deliveredDelta:
      delivered.deltaVsAverage === null
        ? "no average yet"
        : `${formatSigned(delivered.deltaVsAverage)} vs the ${trend.averageCompleted} average`,
    scopeChange: `+${slipped.addedDuringSprint} added, −${slipped.removedDuringSprint} removed`,
    almostDoneStatuses:
      slipped.almostDoneStatuses.length > 0 ? slipped.almostDoneStatuses.join(", ") : "not configured (JIRA_ALMOST_DONE_STATUSES)",
    reliability: formatPercent(trend.reliabilityPercent),
    currentReliability: `this sprint ${formatPercent(trend.currentReliabilityPercent)}`,
    estimateBasis: document.header.includeAddedDuringSprint
      ? "Estimate basis: includes added issues"
      : "Estimate basis: excludes added issues, add --includeAddedDuringSprint to include them all",
  };
}

const GOAL_ITEM_LABELS: Record<GoalItemStatus, string> = {
  achieved: "achieved",
  partial: "partially achieved",
  not_achieved: "not achieved",
  unclear: "unclear",
};

export function formatGoalItemStatus(status: GoalItemStatus): string {
  return GOAL_ITEM_LABELS[status];
}

function formatGoalLine(item: GoalAssessment): string {
  if (item.source !== "llm") {
    return `- ${item.text}`;
  }
  const evidence = item.evidence && item.evidence.length > 0 ? ` · ${item.evidence.join(", ")}` : "";
  const rationale = item.rationale ? ` — ${item.rationale}` : "";
  return `- ${item.text}: ${formatGoalItemStatus(item.status)} (${item.confidence ?? "n/a"} confidence)${evidence}${rationale}`;
}

export function toCommandSummary(document: SprintReviewDocument): string {
  const { header, goal, delivered, slipped, trend, assessment } = document;
  const lines = buildSummaryLines(document);
  const goals = header.sprint.goals.length === 0 ? ["- n/a"] : goal.goals.map(formatGoalLine);
  const summarySource = assessment ? `${assessment.model}${assessment.teamRules ? " · team rules" : ""}` : "";
  const summary = assessment ? [`Summary (${summarySource}): ${assessment.summary}`, ""] : [];
  const sprintRows =
    trend.sprints.length === 0
      ? ["- no closed sprints yet"]
      : trend.sprints.map(
          (sprint) =>
            `- ${sprint.name}: ${formatNumber(sprint.completed)} / ${formatNumber(sprint.committed)} (${formatPercent(sprint.reliabilityPercent)})`
        );

  return [
    `Sprint Review — ${header.projectKey} / Board ${header.boardId}`,
    `Sprint: ${header.sprint.name} (${header.sprint.state ?? "n/a"})`,
    `Dates: ${header.sprint.startDate} → ${header.sprint.endDate} · days left: ${lines.daysLeft}`,
    lines.estimateBasis,
    "",
    ...summary,
    `Goal — ${lines.goalStatus}`,
    ...goals,
    `Tickets done: ${lines.ticketsDone} (${lines.cancelled})`,
    `Points delivered: ${lines.pointsDelivered} · ${lines.averageReliability}`,
    "",
    `Delivered — ${delivered.tickets} tickets`,
    `Points: ${formatNumber(delivered.points)} (${lines.deliveredDelta})`,
    `Cancelled: ${delivered.cancelledCount} · Done elsewhere: ${delivered.doneElsewhereCount}`,
    ...formatIssueList(delivered.issues),
    "",
    "Slipped",
    `Remaining points: ${formatNumber(slipped.remainingPoints)}`,
    `Almost done statuses: ${lines.almostDoneStatuses}`,
    `Almost done: ${slipped.almostDone} · In progress: ${slipped.inProgress} · Not started: ${slipped.notStarted} · Unestimated: ${slipped.unestimated}`,
    `Scope change: ${lines.scopeChange}`,
    ...formatIssueList(slipped.issues),
    "Punted",
    ...formatIssueList(slipped.punted),
    "",
    `Trend — last ${trend.windowSize} closed sprints`,
    `Average completed: ${formatNumber(trend.averageCompleted)} · Average committed: ${formatNumber(trend.averageCommitted)}`,
    `Reliability: ${lines.reliability} (${lines.currentReliability})`,
    ...sprintRows,
  ].join("\n");
}

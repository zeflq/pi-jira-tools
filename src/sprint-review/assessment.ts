// Optional LLM step: judges each sprint goal from the tickets' titles and statuses, and writes a short summary.
// Pure functions with no pi imports; the extension passes in an `LlmComplete` function that calls the model.
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { GoalAssessment, SprintIssue, SprintReviewAssessment, SprintReviewDocument } from "./document";

export type LlmComplete = (prompt: { system: string; user: string }) => Promise<string>;

const MAX_SUMMARY_LENGTH = 1200;
const MAX_RATIONALE_LENGTH = 300;

const AssessmentResponseSchema = Type.Object({
  summary: Type.String(),
  goals: Type.Array(
    Type.Object({
      goal: Type.String(),
      status: Type.Union([Type.Literal("achieved"), Type.Literal("partial"), Type.Literal("not_achieved"), Type.Literal("unclear")]),
      confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
      evidence: Type.Array(Type.String()),
      rationale: Type.String(),
    })
  ),
});

type AssessmentResponse = Static<typeof AssessmentResponseSchema>;

export type AssessmentContext = {
  // Free-text team rules (e.g. from .pi/sprint-review-rules.md): what "done" means, status names, goal conventions.
  teamRules?: string;
};

function section(tag: string, content: string): string | null {
  return content.trim() ? `<${tag}>\n${content.trim()}\n</${tag}>` : null;
}

const OUTPUT_EXAMPLE = JSON.stringify(
  {
    summary: "Payments-V2 pipelines landed; the search revamp slipped because its UAT deploy is still pending.",
    goals: [
      {
        goal: "Ship Payments-V2",
        status: "partial",
        confidence: "high",
        evidence: ["PROJ-12", "PROJ-15"],
        rationale: "PROJ-12 is done but PROJ-15 is still waiting for its UAT deploy.",
      },
    ],
  },
  null,
  2
);

function buildSystemPrompt(context: AssessmentContext): string {
  const base = [
    "You assess a Scrum sprint for its sprint review: for each sprint goal, decide whether it was achieved, from the tickets that contribute to it.",
    "",
    "<verdict_tiers>",
    '- "achieved": every related ticket is done, or only minor ones remain',
    '- "partial": some related tickets are done, or the key ones are almost done (to merge, in review, deploying)',
    '- "not_achieved": the key related tickets are not started or still in progress',
    '- "unclear": no ticket clearly relates to the goal',
    "</verdict_tiers>",
    "",
    "<rules>",
    '- Ticket titles start with a bracketed theme matching their goal, e.g. "[Payments v2][Front] validate workflows" belongs to the goal "Ship Payments-V2"',
    "- `matchedGoals` on a ticket lists the goals its bracketed theme already matches: trust it, and use titles only for tickets without a match",
    "- Judge each goal only from its related tickets and their `stage`; cite only ticket keys from the sprint data",
    "- The numbers in `facts` are computed and correct: never contradict or recompute them",
    "- When the link between tickets and a goal is weak, say so with a low confidence instead of guessing",
    "- Data listed in <data_gaps> is missing: do not invent it, and mention it in the summary when it matters",
    "</rules>",
    "",
    "Return only a JSON object matching this schema exactly (no markdown fences, no extra text, no extra fields):",
    "<output_format>",
    OUTPUT_EXAMPLE,
    "</output_format>",
    "",
    "Field rules:",
    "- summary: 3-4 plain-text sentences for the presenter: what was delivered, what slipped and why, what carries over",
    "- goals: exactly one entry per sprint goal, in the given order",
    "- goal: the goal text exactly as given",
    '- status: "achieved" | "partial" | "not_achieved" | "unclear"',
    '- confidence: "high" | "medium" | "low"',
    "- evidence: keys of the tickets the verdict is based on (may be [] only when status is unclear)",
    "- rationale: one plain-text sentence explaining the verdict",
  ].join("\n");

  return [base, section("team_rules", context.teamRules ?? "")].filter((part): part is string => part !== null).join("\n\n");
}

// "[Payments v2][Front] validate workflows" → ["Payments v2", "Front"]
export function extractTicketThemes(title: string): string[] {
  const leading = title.match(/^\s*((?:\[[^\]]+\]\s*)+)/)?.[1] ?? "";
  return [...leading.matchAll(/\[([^\]]+)\]/g)].map((match) => (match[1] ?? "").trim()).filter((theme) => theme.length > 0);
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A theme matches a goal when one contains the other, ignoring case, spaces and punctuation ("Payments v2" ~ "Ship Payments-V2").
export function matchGoalsByTheme(title: string, goals: string[]): string[] {
  const themes = extractTicketThemes(title)
    .map(compact)
    .filter((theme) => theme.length >= 4);
  return goals.filter((goal) => {
    const goalKey = compact(goal);
    return themes.some((theme) => goalKey.includes(theme) || theme.includes(goalKey));
  });
}

function toTicket(issue: SprintIssue, stage: string, goals: string[]) {
  const matchedGoals = matchGoalsByTheme(issue.summary, goals);
  return {
    key: issue.key,
    title: issue.summary,
    type: issue.issueType,
    status: issue.status,
    points: issue.estimate,
    stage,
    ...(matchedGoals.length > 0 ? { matchedGoals } : {}),
  };
}

const BUCKET_STAGE: Record<NonNullable<SprintIssue["bucket"]>, string> = {
  almost_done: "almost done",
  in_progress: "in progress",
  not_started: "not started",
};

function buildDataGaps(document: SprintReviewDocument, tickets: Array<{ key: string; points: number | null; matchedGoals?: string[] }>): string[] {
  const gaps: string[] = [];
  const unestimated = tickets.filter((ticket) => ticket.points === null).map((ticket) => ticket.key);
  if (unestimated.length > 0) {
    gaps.push(`- No estimate on: ${unestimated.join(", ")}`);
  }
  const unmatched = tickets.filter((ticket) => !ticket.matchedGoals).map((ticket) => ticket.key);
  if (unmatched.length > 0) {
    gaps.push(`- No bracketed theme matching a goal on: ${unmatched.join(", ")}`);
  }
  if (document.goal.pointsCommitted === null) {
    gaps.push("- Points are not available for this sprint (no estimates in scope)");
  }
  if (document.goal.cancelledCount > 0) {
    gaps.push(`- ${document.goal.cancelledCount} cancelled ticket(s) were excluded from the data`);
  }
  return gaps;
}

export function buildAssessmentPrompt(document: SprintReviewDocument, context: AssessmentContext = {}): { system: string; user: string } {
  const goals = document.header.sprint.goals;
  const tickets = [
    ...document.delivered.issues.map((issue) => toTicket(issue, "done", goals)),
    ...document.slipped.issues.map((issue) => toTicket(issue, issue.bucket ? BUCKET_STAGE[issue.bucket] : "open", goals)),
    ...document.slipped.punted.map((issue) => toTicket(issue, "removed from sprint", goals)),
  ];

  const payload = {
    sprint: {
      name: document.header.sprint.name,
      startDate: document.header.sprint.startDate,
      endDate: document.header.sprint.endDate,
      state: document.header.sprint.state,
    },
    goals,
    facts: {
      ticketsDone: document.goal.ticketsDone,
      ticketsTotal: document.goal.ticketsTotal,
      cancelledTickets: document.goal.cancelledCount,
      pointsDone: document.goal.pointsDone,
      pointsCommitted: document.goal.pointsCommitted,
      remainingPoints: document.slipped.remainingPoints,
      addedDuringSprint: document.slipped.addedDuringSprint,
      removedDuringSprint: document.slipped.removedDuringSprint,
      workingDaysLeft: document.goal.daysLeft,
    },
    tickets,
  };

  const user = [
    "Assess this sprint:",
    section("sprint", JSON.stringify(payload, null, 2)),
    section("data_gaps", buildDataGaps(document, tickets).join("\n")),
  ]
    .filter((part): part is string => part !== null)
    .join("\n");

  return { system: buildSystemPrompt(context), user };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function clip(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function normalizeGoalText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

// Returns null when the answer is unusable. Unknown goals are dropped and made-up ticket keys removed.
export function parseAssessment(
  text: string,
  document: SprintReviewDocument,
  model: string,
  context: AssessmentContext = {}
): SprintReviewAssessment | null {
  const parsed = extractJson(text);
  if (!Check(AssessmentResponseSchema, parsed)) {
    return null;
  }
  const response = parsed as AssessmentResponse;

  const knownGoals = new Map(document.header.sprint.goals.map((goal) => [normalizeGoalText(goal), goal]));
  const knownKeys = new Set(
    [...document.delivered.issues, ...document.slipped.issues, ...document.slipped.punted].map((issue) => issue.key)
  );
  const seen = new Set<string>();
  const goals: SprintReviewAssessment["goals"] = [];

  for (const item of response.goals) {
    const goal = knownGoals.get(normalizeGoalText(item.goal));
    if (!goal || seen.has(goal)) {
      continue;
    }
    seen.add(goal);
    const evidence = [...new Set(item.evidence.map((key) => key.trim().toUpperCase()))].filter((key) => knownKeys.has(key));
    goals.push({
      goal,
      status: item.status,
      // A verdict with no valid evidence is not trustworthy, whatever the model claimed.
      confidence: evidence.length === 0 && item.status !== "unclear" ? "low" : item.confidence,
      evidence,
      rationale: clip(item.rationale, MAX_RATIONALE_LENGTH),
    });
  }

  return { model, summary: clip(response.summary, MAX_SUMMARY_LENGTH), goals, teamRules: Boolean(context.teamRules?.trim()) };
}

export function applyAssessment(document: SprintReviewDocument, assessment: SprintReviewAssessment): SprintReviewDocument {
  const byGoal = new Map(assessment.goals.map((item) => [item.goal, item]));
  const goals: GoalAssessment[] = document.goal.goals.map((goal) => {
    const verdict = byGoal.get(goal.text);
    if (!verdict) {
      return goal;
    }
    return {
      text: goal.text,
      status: verdict.status,
      source: "llm",
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      rationale: verdict.rationale,
    };
  });

  return { ...document, goal: { ...document.goal, goals }, assessment };
}

// FNV-1a over the sprint id and everything the LLM sees (prompt, data, team rules): same key means the cached verdict still applies.
export function assessmentCacheKey(document: SprintReviewDocument, context: AssessmentContext = {}): string {
  const { system, user } = buildAssessmentPrompt(document, context);
  const input = `${system}\n${user}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${document.header.sprint.id}:${(hash >>> 0).toString(16)}`;
}

export async function assessSprint(
  document: SprintReviewDocument,
  llm: LlmComplete,
  model: string,
  context: AssessmentContext = {}
): Promise<{ assessment: SprintReviewAssessment | null; error?: string }> {
  if (document.header.sprint.goals.length === 0) {
    return { assessment: null, error: "the sprint has no goal" };
  }

  try {
    const text = await llm(buildAssessmentPrompt(document, context));
    const assessment = parseAssessment(text, document, model, context);
    return assessment ? { assessment } : { assessment: null, error: "the model answer was not valid JSON for the expected shape" };
  } catch (error) {
    return { assessment: null, error: error instanceof Error ? error.message : String(error) };
  }
}

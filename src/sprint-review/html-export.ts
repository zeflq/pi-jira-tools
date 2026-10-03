import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { GoalItemStatus, SprintGoalStatus, SprintIssue, SprintReviewDocument } from "./document";
import { buildCoverSvg, parseSprintTheme } from "./cover";
import { buildTrendChartSvg } from "./trend-chart";
import { buildSummaryLines, formatNumber, formatPercent } from "./formatters";

const SPRINT_REVIEW_TEMPLATE_URL = new URL("./templates/sprint-review.html", import.meta.url);
const SPRINT_REVIEW_EXPORT_PREFIX = "Sprint review";

const GOAL_ITEM_VIEW: Record<GoalItemStatus, { label: string; className: string }> = {
  achieved: { label: "Achieved", className: "is-success" },
  partial: { label: "Partially achieved", className: "is-warning" },
  not_achieved: { label: "Not achieved", className: "is-danger" },
  unclear: { label: "Not assessed", className: "is-neutral" },
};

const GOAL_STATUS_CLASS: Record<SprintGoalStatus, string> = {
  achieved: "is-success",
  partial: "is-warning",
  missed: "is-danger",
};

function toIssueRow(issue: SprintIssue) {
  return {
    key: issue.key,
    summary: issue.summary,
    meta: [issue.issueType, issue.status].filter(Boolean).join(" · "),
    priority: issue.priority ?? "n/a",
    estimate: formatNumber(issue.estimate),
  };
}

// HTML-only view: CSS classes, icons and pre-formatted values the logic-less template cannot compute.
function toHtmlView(document: SprintReviewDocument) {
  const lines = buildSummaryLines(document);
  return {
    doc: document,
    lines,
    view: {
      coverSvg: buildCoverSvg(document.header.sprint.name),
      coverTheme: parseSprintTheme(document.header.sprint.name).theme,
      coverLabel: parseSprintTheme(document.header.sprint.name).label,
      goalStatusClass: GOAL_STATUS_CLASS[document.goal.status],
      goals: document.goal.goals.map((goal) => ({
        text: goal.text,
        statusLabel: goal.source === "llm" && goal.status === "unclear" ? "Unclear" : GOAL_ITEM_VIEW[goal.status].label,
        statusClass: GOAL_ITEM_VIEW[goal.status].className,
        confidence: goal.confidence ? `${goal.confidence} confidence` : "",
        rationale: goal.rationale ?? "",
        evidence: goal.evidence && goal.evidence.length > 0 ? goal.evidence.join(" · ") : "",
      })),
      // 0 or 1 item: the template has no {{#if}}, so optional blocks are rendered with {{#each}}.
      summary: document.assessment
        ? [
            {
              text: document.assessment.summary,
              model: document.assessment.model,
              teamRules: document.assessment.teamRules ? " · with team rules (.pi/sprint-review-rules.md)" : "",
            },
          ]
        : [],
      goalNotes: document.goal.goals
        .filter((goal) => goal.source === "llm")
        .map((goal) => ({ text: goal.text, status: GOAL_ITEM_VIEW[goal.status].label, rationale: goal.rationale ?? "" })),
      deliveredPoints: formatNumber(document.delivered.points),
      remainingPoints: formatNumber(document.slipped.remainingPoints),
      averageCompleted: formatNumber(document.trend.averageCompleted),
      averageCommitted: formatNumber(document.trend.averageCommitted),
      deliveredIssues: document.delivered.issues.map(toIssueRow),
      slippedIssues: document.slipped.issues.map(toIssueRow),
      puntedIssues: document.slipped.punted.map(toIssueRow),
      // 0 or 1 item, rendered with {{#each}} since the template has no {{#if}}.
      trendChart: document.trend.sprints.length > 0 ? [{ svg: buildTrendChartSvg(document.trend) }] : [],
      sprints: document.trend.sprints.map((sprint) => ({
        name: sprint.name,
        completed: formatNumber(sprint.completed),
        committed: formatNumber(sprint.committed),
        reliability: formatPercent(sprint.reliabilityPercent),
        barWidth: `${Math.min(sprint.reliabilityPercent ?? 0, 100)}%`,
      })),
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveTemplateValue(context: Record<string, unknown>, rawPath: string): unknown {
  const path = rawPath.trim();
  if (path === "this") {
    return context.this;
  }

  if (path === "@key") {
    return context["@key"];
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, context);
}

function normalizeEachItems(value: unknown, rootContext: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item !== null && typeof item === "object") {
        return { ...rootContext, ...(item as Record<string, unknown>), this: item };
      }

      return { ...rootContext, this: item };
    });
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, item]) => {
        if (item !== null && typeof item === "object") {
          return { ...rootContext, ...(item as Record<string, unknown>), "@key": key, this: item };
        }

        return { ...rootContext, "@key": key, this: item };
      });
  }

  return [];
}

function renderSprintReviewTemplate(template: string, context: Record<string, unknown>): string {
  const renderedEach = template.replace(/{{#each\s+([^}]+)}}([\s\S]*?){{\/each}}/g, (_match, rawPath: string, body: string) => {
    const [truthyBody, falsyBody = ""] = body.split("{{else}}");
    const value = resolveTemplateValue(context, rawPath);
    const items = normalizeEachItems(value, context);

    if (items.length === 0) {
      return renderSprintReviewTemplate(falsyBody, context);
    }

    return items.map((item) => renderSprintReviewTemplate(truthyBody, item)).join("");
  });

  // {{{path}}} inserts trusted markup we generate ourselves (the cover SVG) without escaping.
  const renderedRaw = renderedEach.replace(/{{{\s*([^}]+?)\s*}}}/g, (_match, rawPath: string) => {
    const value = resolveTemplateValue(context, rawPath);
    return value === null || value === undefined ? "" : String(value);
  });

  return renderedRaw.replace(/{{\s*([^{}#\/][^}]*)\s*}}/g, (_match, rawPath: string) => {
    const value = resolveTemplateValue(context, rawPath);
    if (value === null || value === undefined) {
      return "";
    }

    return escapeHtml(String(value));
  });
}

function loadSprintReviewTemplate(): string {
  const candidatePaths = [
    fileURLToPath(SPRINT_REVIEW_TEMPLATE_URL),
    resolve(process.cwd(), ".pi/extensions/jira-tools/src/sprint-review/templates/sprint-review.html"),
    resolve(process.cwd(), "src/sprint-review/templates/sprint-review.html"),
  ];

  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, "utf8");
    }
  }

  throw new Error(`Unable to load sprint review template. Tried: ${candidatePaths.join(", ")}`);
}

export function renderSprintReviewHtml(document: SprintReviewDocument): string {
  return renderSprintReviewTemplate(loadSprintReviewTemplate(), toHtmlView(document) as unknown as Record<string, unknown>);
}

export function buildSprintReviewExportFileName(endDate: string): string {
  return `${SPRINT_REVIEW_EXPORT_PREFIX} ${endDate}.html`;
}

export async function writeSprintReviewHtmlExport(document: SprintReviewDocument): Promise<string> {
  const fileName = buildSprintReviewExportFileName(document.header.sprint.endDate);
  const outputDirectory = resolve(process.cwd(), ".pi", "sprintReviewReports");
  const outputPath = resolve(outputDirectory, fileName);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, renderSprintReviewHtml(document), "utf8");
  return outputPath;
}

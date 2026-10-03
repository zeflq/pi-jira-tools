import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createJiraClient,
  createJiraClientConfig,
  validateJiraStartupConfig,
  type JiraClient,
  type JiraCommentInput,
  type JiraCreateIssueInput,
  type JiraUpdateIssueInput,
} from "../src/jira/client";
import { parseSprintReviewCommandArgs, type SprintReviewCommandConfig } from "../src/sprint-review/command-args";
import {
  applyAssessment,
  assessmentCacheKey,
  assessSprint,
  type AssessmentContext,
  type LlmComplete,
} from "../src/sprint-review/assessment";
import { buildSprintReviewDocument, type SprintReviewAssessment } from "../src/sprint-review/document";
import { toCommandSummary } from "../src/sprint-review/formatters";
import { buildSprintReviewExportFileName, writeSprintReviewHtmlExport } from "../src/sprint-review/html-export";
import { buildSprintReviewPptxFileName, writeSprintReviewPptxExport } from "../src/sprint-review/pptx-export";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  details: unknown;
};

const createIssueSchema = Type.Object({
  issueType: Type.Optional(Type.String({ minLength: 1 })),
  summary: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  acceptanceCriteria: Type.Optional(Type.String()),
});

const updateIssueSchema = Type.Object({
  issueKey: Type.String({ minLength: 1 }),
  summary: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  labels: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(Type.String()),
});

const issueKeySchema = Type.Object({
  issueKey: Type.String({ minLength: 1 }),
});

const commentSchema = Type.Object({
  issueKey: Type.String({ minLength: 1 }),
  comment: Type.String({ minLength: 1 }),
});

const sprintReviewSchema = Type.Object({
  projectKey: Type.String({ minLength: 1 }),
  boardId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Integer({ minimum: 1 })])),
});

type JiraSprintReviewInput = {
  projectKey: string;
  boardId?: string | number;
};

function toToolResult(title: string, data: unknown): ToolResult {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text: `${title}\n${body}` }],
    details: data,
  };
}

function toToolError(title: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${title}\n${message}` }],
    isError: true,
    details: { message },
  };
}

function registerTool<TInput>(
  pi: ExtensionAPI,
  name: string,
  description: string,
  schema: ReturnType<typeof Type.Object>,
  handler: (input: TInput) => Promise<ToolResult> | ToolResult
): void {
  pi.registerTool({
    name,
    label: name,
    description,
    promptSnippet: description,
    promptGuidelines: [description],
    parameters: schema,
    async execute(_toolCallId: string, params: TInput, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: ExtensionContext) {
      try {
        return await handler(params);
      } catch (error) {
        return toToolError(`${name} failed`, error);
      }
    },
  });
}

export function registerJiraTools(pi: ExtensionAPI, getClient: () => JiraClient = () => createJiraClient()): void {
  registerTool<JiraCreateIssueInput>(
    pi,
    "jiraCreateIssue",
    "Create a Jira issue from a user request. Default issue type is Story when not provided.",
    createIssueSchema,
    async (input) => {
      const client = getClient();
      const issue = await client.createIssue(input);
      return toToolResult(`Created Jira issue ${issue.key}`, issue);
    }
  );

  registerTool<JiraUpdateIssueInput>(
    pi,
    "jiraUpdateIssue",
    "Update an existing Jira issue with the fields the user explicitly asked to change.",
    updateIssueSchema,
    async (input) => {
      const client = getClient();
      const issue = await client.updateIssue(input);
      return toToolResult(`Updated Jira issue ${issue.key}`, issue);
    }
  );

  registerTool<{ issueKey: string }>(
    pi,
    "jiraGetIssue",
    "Fetch the current state of a Jira issue.",
    issueKeySchema,
    async ({ issueKey }) => {
      const client = getClient();
      const issue = await client.getIssue(issueKey);
      return toToolResult(`Jira issue ${issue.key}`, issue);
    }
  );

  registerTool<JiraCommentInput>(
    pi,
    "jiraAddComment",
    "Add a comment to an existing Jira issue.",
    commentSchema,
    async (input) => {
      const client = getClient();
      const comment = await client.addComment(input);
      return toToolResult(`Added comment to Jira issue ${input.issueKey.toUpperCase()}`, comment);
    }
  );

  registerTool<JiraSprintReviewInput>(
    pi,
    "jiraGetSprintReview",
    "Fetch sprint review data for a Jira project board, including the active sprint, issue buckets, and progress metrics. When boardId is omitted, the JIRA_BOARD_ID env var is used.",
    sprintReviewSchema,
    async ({ projectKey, boardId }) => {
      const client = getClient();
      const snapshot = await client.getSprintReviewSnapshot(projectKey, boardId);
      return toToolResult(`Sprint review snapshot for ${snapshot.projectKey} board ${snapshot.boardId}`, snapshot);
    }
  );
}

const ASSESSMENT_ENTRY = "jira-sprint-review-assessment";
// Optional team context for the LLM, like pi-reviewer's review rules: goal conventions, what "done" means, status names.
const TEAM_RULES_FILE = ".pi/sprint-review-rules.md";

function loadAssessmentContext(): AssessmentContext {
  const path = resolve(process.cwd(), TEAM_RULES_FILE);
  // HTML comments are notes for people editing the file, not rules for the model.
  return existsSync(path) ? { teamRules: readFileSync(path, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim() } : {};
}
const LLM_TIMEOUT_MS = 60_000;

export type SprintReviewCommandContext = {
  ui: {
    notify: (message: string, level: "info" | "warning" | "error") => void;
    setStatus?: (key: string, text: string | undefined) => void;
  };
  sessionManager?: { getEntries(): readonly unknown[] };
};

export type LlmProvider = (ctx: SprintReviewCommandContext) => Promise<{ complete: LlmComplete; model: string } | { error: string }>;

// Uses the model and credentials already selected in pi, so the extension needs no LLM configuration of its own.
function toText(response: AssistantMessage): string {
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage ?? `model call ${response.stopReason}`);
  }
  return response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

// Calls the model selected in pi through modelRegistry.complete() (pi >= 1.0): pi resolves credentials and
// routes the request through its own provider adapters, so gateway models (e.g. "openai/gpt-5-mini:batch") work.
export const piLlmProvider: LlmProvider = async (ctx) => {
  const { model, modelRegistry } = ctx as unknown as ExtensionCommandContext;
  if (!model) {
    return { error: "no model is selected in pi" };
  }
  if (typeof modelRegistry?.complete !== "function") {
    return { error: "this pi version cannot call models from extensions; update pi to 1.0 or later" };
  }

  return {
    model: model.id,
    complete: async ({ system, user }) => {
      const context: Context = {
        systemPrompt: system,
        messages: [{ role: "user", content: user, timestamp: Date.now() }],
      };
      return toText(await modelRegistry.complete(model, context, { signal: AbortSignal.timeout(LLM_TIMEOUT_MS) }));
    },
  };
};

const STATUS_KEY = "jira-sprint-review";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Footer status with a spinner while the report is built; always cleared by done().
function startProgress(ctx: SprintReviewCommandContext) {
  let step = "starting…";
  let frame = 0;
  const render = () => ctx.ui.setStatus?.(STATUS_KEY, `${SPINNER[frame++ % SPINNER.length]} Sprint review · ${step}`);
  render();
  const timer = setInterval(render, 120);
  timer.unref?.();
  return {
    update(next: string) {
      step = next;
      render();
    },
    done() {
      clearInterval(timer);
      ctx.ui.setStatus?.(STATUS_KEY, undefined);
    },
  };
}

function findCachedAssessment(ctx: SprintReviewCommandContext, key: string): SprintReviewAssessment | null {
  const entries = ctx.sessionManager?.getEntries() ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: string; customType?: string; data?: { key?: string; assessment?: SprintReviewAssessment } };
    if (entry?.type === "custom" && entry.customType === ASSESSMENT_ENTRY && entry.data?.key === key && entry.data.assessment) {
      return entry.data.assessment;
    }
  }
  return null;
}

export function registerJiraCommands(
  pi: ExtensionAPI,
  getClient: () => JiraClient = () => createJiraClient(),
  getConfig: () => SprintReviewCommandConfig = () => createJiraClientConfig(),
  getLlm: LlmProvider = piLlmProvider
): void {
  pi.registerCommand("sprintReview", {
    description:
      "Show sprint review data for a Jira project board. Use --html for an HTML deck and --pptx for a PowerPoint deck (both with LLM goal assessment; --no-assess to skip), and --assess to add it to the CLI summary.",
    handler: async (args: string, ctx: SprintReviewCommandContext) => {
      const commandConfig = getConfig();
      const parsedArgs = parseSprintReviewCommandArgs(args);
      const projectKey = parsedArgs.projectKey ?? commandConfig.projectKey;
      const boardId = parsedArgs.boardId ?? commandConfig.boardId;
      const includeAddedDuringSprint = parsedArgs.includeAddedDuringSprint ?? commandConfig.includeAddedDuringSprint ?? false;
      const exportHtml = parsedArgs.exportHtml ?? commandConfig.exportHtml ?? false;
      const exportPptx = parsedArgs.exportPptx ?? commandConfig.exportPptx ?? false;
      // Exports are what people see, so they include the LLM assessment unless --no-assess.
      const assess = parsedArgs.assess ?? commandConfig.assess ?? (exportHtml || exportPptx);

      if (!projectKey) {
        throw new Error("Provide a projectKey or configure JIRA_PROJECT_KEY for /sprintReview.");
      }

      const progress = startProgress(ctx);
      try {
        const client = getClient();
        progress.update("fetching sprint from Jira…");
        const [snapshot, teamVelocity] = await Promise.all([
          client.getSprintReviewSnapshot(projectKey, boardId),
          client.getTeamVelocity(projectKey, boardId, 5, includeAddedDuringSprint),
        ]);
        let document = buildSprintReviewDocument(snapshot, teamVelocity, {
          includeAddedDuringSprint,
          cancelledStatuses: commandConfig.cancelledStatuses ?? [],
          almostDoneStatuses: commandConfig.almostDoneStatuses ?? [],
          notStartedStatuses: commandConfig.notStartedStatuses,
        });

        if (assess) {
          const assessmentContext = loadAssessmentContext();
          const cacheKey = assessmentCacheKey(document, assessmentContext);
          const cached = findCachedAssessment(ctx, cacheKey);
          if (cached) {
            document = applyAssessment(document, cached);
          } else {
            const llm = await getLlm(ctx);
            if (!("error" in llm)) {
              progress.update(`assessing goals with ${llm.model}${assessmentContext.teamRules ? " + team rules" : ""}…`);
            }
            const result = "error" in llm ? { assessment: null, error: llm.error } : await assessSprint(document, llm.complete, llm.model, assessmentContext);
            if (result.assessment) {
              document = applyAssessment(document, result.assessment);
              pi.appendEntry(ASSESSMENT_ENTRY, { key: cacheKey, assessment: result.assessment });
            } else {
              ctx.ui.notify(`LLM goal assessment skipped: ${result.error}`, "warning");
            }
          }
        }

        pi.appendEntry("jira-sprint-review", document);

        if (exportHtml || exportPptx) {
          const exported: string[] = [];
          if (exportHtml) {
            progress.update("writing HTML deck…");
            await writeSprintReviewHtmlExport(document);
            exported.push(buildSprintReviewExportFileName(document.header.sprint.endDate));
          }
          if (exportPptx) {
            progress.update("writing PowerPoint deck…");
            await writeSprintReviewPptxExport(document);
            exported.push(buildSprintReviewPptxFileName(document.header.sprint.endDate));
          }
          ctx.ui.notify(`Exported ${exported.length === 1 ? "report" : "reports"} to ${exported.join(" and ")}`, "info");
          return;
        }

        ctx.ui.notify(toCommandSummary(document), "info");
      } finally {
        progress.done();
      }
    },
  });
}

export default function (pi: ExtensionAPI) {
  const startupConfig = validateJiraStartupConfig();
  console.info(`Jira tools startup check passed for ${startupConfig.baseUrl}`);

  registerJiraTools(pi);
  registerJiraCommands(pi);
}

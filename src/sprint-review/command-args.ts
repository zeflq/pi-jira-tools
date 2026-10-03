// Parses /sprintReview arguments: "PROJ 42 --includeAddedDuringSprint --html" or a JSON object.
export type SprintReviewCommandConfig = {
  projectKey?: string;
  boardId?: string;
  includeAddedDuringSprint?: boolean;
  exportHtml?: boolean;
  exportPptx?: boolean;
  // LLM goal assessment: on by default with --html, opt in with --assess, opt out with --no-assess.
  assess?: boolean;
  cancelledStatuses?: string[];
  almostDoneStatuses?: string[];
  notStartedStatuses?: string[];
};

function normalizeCommandBoardId(value: unknown): string | number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (["null", "undefined", "unset"].includes(trimmed.toLowerCase())) {
      return undefined;
    }

    return trimmed;
  }

  return undefined;
}

export function parseSprintReviewCommandArgs(args: string): SprintReviewCommandConfig {
  const trimmed = args.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        projectKey?: unknown;
        boardId?: unknown;
        includeAddedDuringSprint?: unknown;
        exportHtml?: unknown;
        exportPptx?: unknown;
        assess?: unknown;
      };
      return {
        projectKey: typeof parsed.projectKey === "string" ? parsed.projectKey.trim() || undefined : undefined,
        boardId: normalizeCommandBoardId(parsed.boardId)?.toString(),
        includeAddedDuringSprint: typeof parsed.includeAddedDuringSprint === "boolean" ? parsed.includeAddedDuringSprint : undefined,
        exportHtml: typeof parsed.exportHtml === "boolean" ? parsed.exportHtml : undefined,
        exportPptx: typeof parsed.exportPptx === "boolean" ? parsed.exportPptx : undefined,
        assess: typeof parsed.assess === "boolean" ? parsed.assess : undefined,
      };
    } catch {
      // Fall back to whitespace parsing.
    }
  }

  let projectKey: string | undefined;
  let boardId: string | undefined;
  let includeAddedDuringSprint: boolean | undefined;
  let exportHtml: boolean | undefined;
  let assess: boolean | undefined;
  let exportPptx: boolean | undefined;

  for (const token of trimmed.split(/\s+/)) {
    if (token === "--includeAddedDuringSprint") {
      includeAddedDuringSprint = true;
      continue;
    }

    if (token === "--html") {
      exportHtml = true;
      continue;
    }

    if (token === "--pptx") {
      exportPptx = true;
      continue;
    }

    if (token === "--assess" || token === "--no-assess") {
      assess = token === "--assess";
      continue;
    }

    if (!projectKey) {
      projectKey = token.trim() || undefined;
      continue;
    }

    if (!boardId) {
      boardId = normalizeCommandBoardId(token)?.toString();
    }
  }

  return {
    projectKey,
    boardId,
    includeAddedDuringSprint,
    exportHtml,
    exportPptx,
    assess,
  };
}

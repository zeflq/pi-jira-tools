// Native PowerPoint export of the sprint review deck: same 5 slides, colors and numbers as the HTML deck,
// built from the same SprintReviewDocument. Everything is a real PowerPoint object (text, shapes, tables,
// a native chart) so the deck stays editable; LLM summary and goal reasons go into the speaker notes.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import PptxGenJS from "pptxgenjs";
import { buildCoverShapes, COVER_CANVAS, parseSprintTheme } from "./cover";
import type { GoalAssessment, GoalItemStatus, SprintGoalStatus, SprintIssue, SprintReviewDocument } from "./document";
import { buildSummaryLines, formatGoalItemStatus, formatNumber, formatPercent } from "./formatters";

// The web deck's palette (src/sprint-review/templates/sprint-review.html), without "#".
const COLOR = {
  red: "ED1A3A",
  black: "0A0A0A",
  white: "FFFFFF",
  offWhite: "F8F8F8",
  lightGray: "F0F0F0",
  midGray: "E0E0E0",
  gray: "888888",
  darkGray: "444444",
  committed: "EF8796",
};

const STATUS_STYLE: Record<"success" | "warning" | "danger" | "neutral", { text: string; fill: string; line: string }> = {
  success: { text: "1A7A3A", fill: "F6FFF8", line: "B6E8C2" },
  warning: { text: "8A6000", fill: "FFFBEE", line: "F0D870" },
  danger: { text: "C0392B", fill: "FFF8F8", line: "F0C0C0" },
  neutral: { text: COLOR.gray, fill: COLOR.offWhite, line: COLOR.midGray },
};

const GOAL_ITEM_STYLE: Record<GoalItemStatus, keyof typeof STATUS_STYLE> = {
  achieved: "success",
  partial: "warning",
  not_achieved: "danger",
  unclear: "neutral",
};

const GOAL_STATUS_STYLE: Record<SprintGoalStatus, keyof typeof STATUS_STYLE> = {
  achieved: "success",
  partial: "warning",
  missed: "danger",
};

// Office-safe fonts so the deck lays out the same on any machine (the web deck's Sora / JetBrains Mono
// are web fonts that are usually not installed on presenters' laptops).
const FONT = { sans: "Arial", mono: "Consolas" };

const SLIDE = { w: 13.333, h: 7.5 };
const MARGIN = 0.6;
const CONTENT_W = SLIDE.w - MARGIN * 2;
const KPI_Y = 1.85;
const KPI_H = 1.05;
const BODY_Y = 3.15;
const BODY_BOTTOM = 7.0;
const ROW_H = 0.44;
const FIRST_PAGE_ROWS = 6;
const NEXT_PAGE_ROWS = 10;

type Slide = PptxGenJS.Slide;
type TableRow = PptxGenJS.TableRow;

function text(slide: Slide, value: string, options: PptxGenJS.TextPropsOptions): void {
  slide.addText(value, { isTextBox: true, margin: 0, fontFace: FONT.sans, color: COLOR.black, valign: "top", ...options });
}

function pageHeader(slide: Slide, document: SprintReviewDocument, kicker: string, title: string, subtitle: string): void {
  text(slide, document.header.sprint.endDate, {
    x: SLIDE.w - MARGIN - 2.5, y: 0.35, w: 2.5, h: 0.3, align: "right", fontFace: FONT.mono, fontSize: 11, bold: true, color: COLOR.red,
  });
  text(slide, kicker.toUpperCase(), { x: MARGIN, y: 0.4, w: 6, h: 0.25, fontFace: FONT.mono, fontSize: 10, bold: true, color: COLOR.red, charSpacing: 2 });
  slide.addShape("rect", { x: MARGIN, y: 0.72, w: 0.07, h: 0.55, fill: { color: COLOR.red }, line: { color: COLOR.red, width: 0 } });
  text(slide, title, { x: MARGIN + 0.22, y: 0.66, w: CONTENT_W - 0.22, h: 0.66, fontSize: 30, bold: true, valign: "middle" });
  if (subtitle) {
    text(slide, subtitle, { x: MARGIN + 0.22, y: 1.36, w: CONTENT_W - 0.22, h: 0.3, fontFace: FONT.mono, fontSize: 11, color: COLOR.gray });
  }
}

type Kpi = { label: string; value: string; sub?: string; valueColor?: string };

function kpiRow(slide: Slide, kpis: Kpi[]): void {
  const gap = 0.2;
  const width = (CONTENT_W - gap * (kpis.length - 1)) / kpis.length;
  kpis.forEach((kpi, index) => {
    const x = MARGIN + index * (width + gap);
    slide.addShape("roundRect", {
      x, y: KPI_Y, w: width, h: KPI_H, rectRadius: 0.08, fill: { color: COLOR.white }, line: { color: COLOR.midGray, width: 1 },
    });
    text(slide, kpi.label.toUpperCase(), { x: x + 0.2, y: KPI_Y + 0.14, w: width - 0.4, h: 0.22, fontFace: FONT.mono, fontSize: 9, color: COLOR.gray, charSpacing: 1 });
    text(slide, kpi.value, { x: x + 0.2, y: KPI_Y + 0.36, w: width - 0.4, h: 0.42, fontSize: 21, bold: true, color: kpi.valueColor ?? COLOR.black, fit: "shrink" });
    if (kpi.sub) {
      text(slide, kpi.sub, { x: x + 0.2, y: KPI_Y + 0.78, w: width - 0.4, h: 0.22, fontFace: FONT.mono, fontSize: 9, color: COLOR.gray });
    }
  });
}

function paginate<T>(items: T[]): T[][] {
  const pages: T[][] = [items.slice(0, FIRST_PAGE_ROWS)];
  for (let start = FIRST_PAGE_ROWS; start < items.length; start += NEXT_PAGE_ROWS) {
    pages.push(items.slice(start, start + NEXT_PAGE_ROWS));
  }
  return pages;
}

const HEADER_CELL: PptxGenJS.TableCellProps = {
  fill: { color: COLOR.lightGray }, color: COLOR.gray, fontFace: FONT.mono, fontSize: 9, bold: true, valign: "middle",
};

function issueRows(issues: SprintIssue[], emptyText: string, withPriority: boolean): TableRow[] {
  const header: TableRow = [
    { text: "TICKET", options: { ...HEADER_CELL } },
    { text: "SUMMARY", options: { ...HEADER_CELL } },
    ...(withPriority ? [{ text: "PRIORITY", options: { ...HEADER_CELL } }] : []),
    { text: "PTS", options: { ...HEADER_CELL, align: "right" as const } },
  ];
  if (issues.length === 0) {
    return [header, [{ text: emptyText, options: { colspan: withPriority ? 4 : 3, italic: true, color: COLOR.gray, fontSize: 11 } }]];
  }
  return [
    header,
    ...issues.map((issue): TableRow => {
      const meta = [issue.issueType, issue.status].filter(Boolean).join(" · ");
      return [
        { text: issue.key, options: { fontFace: FONT.mono, fontSize: 10 } },
        {
          text: [
            { text: issue.summary, options: { fontSize: 11, breakLine: Boolean(meta) } },
            ...(meta ? [{ text: meta, options: { fontSize: 8, color: COLOR.gray, fontFace: FONT.mono } }] : []),
          ],
        },
        ...(withPriority ? [{ text: issue.priority ?? "n/a", options: { fontSize: 11 } }] : []),
        { text: formatNumber(issue.estimate), options: { fontSize: 11, align: "right" as const } },
      ];
    }),
  ];
}

function addIssueTable(slide: Slide, rows: TableRow[], x: number, y: number, colW: number[]): void {
  slide.addTable(rows, {
    x, y, w: colW.reduce((sum, width) => sum + width, 0), colW, rowH: ROW_H, fontFace: FONT.sans, color: COLOR.black, valign: "middle",
    border: { type: "solid", pt: 0.75, color: COLOR.midGray }, margin: [0.04, 0.1, 0.04, 0.1],
  });
}

function panelTitle(slide: Slide, title: string, count: string, x: number, y: number, w: number): void {
  text(slide, title, { x, y, w: w * 0.6, h: 0.3, fontSize: 14, bold: true });
  text(slide, count, { x: x + w * 0.4, y: y + 0.04, w: w * 0.6, h: 0.26, align: "right", fontFace: FONT.mono, fontSize: 9, color: COLOR.gray });
}

// ── Slide 1: cover ───────────────────────────────────────────────────────────

function coverSlide(pres: PptxGenJS, document: SprintReviewDocument): void {
  const slide = pres.addSlide();
  const lines = buildSummaryLines(document);
  const split = 7.33;

  // Right panel: black, with the generated art faded behind the theme title (same geometry as the web SVG).
  slide.addShape("rect", { x: split, y: 0, w: SLIDE.w - split, h: SLIDE.h, fill: { color: COLOR.black }, line: { color: COLOR.black, width: 0 } });
  const scale = Math.max((SLIDE.w - split) / COVER_CANVAS.width, SLIDE.h / COVER_CANVAS.height);
  const offsetY = (SLIDE.h - COVER_CANVAS.height * scale) / 2;
  for (const shape of buildCoverShapes(document.header.sprint.name)) {
    const color = shape.ink ? COLOR.offWhite : shape.color.replace("#", "").toUpperCase();
    const transparency = Math.round(100 - shape.opacity * 16);
    if (shape.kind === "rect") {
      slide.addShape("rect", {
        x: split + shape.x * scale, y: offsetY + shape.y * scale, w: shape.w * scale, h: shape.h * scale, rotate: shape.rotate ?? 0,
        fill: { color, transparency }, line: { color, width: 0, transparency: 100 },
      });
    } else {
      slide.addShape("ellipse", {
        x: split + (shape.cx - shape.r) * scale, y: offsetY + (shape.cy - shape.r) * scale, w: shape.r * 2 * scale, h: shape.r * 2 * scale,
        ...(shape.strokeWidth
          ? { fill: { color, transparency: 100 }, line: { color, width: shape.strokeWidth * scale * 72, transparency } }
          : { fill: { color, transparency }, line: { color, width: 0, transparency: 100 } }),
      });
    }
  }

  // Left panel drawn after the art so shapes that spill past the split are hidden behind it.
  slide.addShape("rect", { x: 0, y: 0, w: split, h: SLIDE.h, fill: { color: COLOR.white }, line: { color: COLOR.white, width: 0 } });
  slide.addShape("rect", { x: 0, y: 0, w: 0.08, h: SLIDE.h, fill: { color: COLOR.red }, line: { color: COLOR.red, width: 0 } });

  text(slide, `${document.header.sprint.startDate} → ${document.header.sprint.endDate}`, {
    x: 0.9, y: 2.2, w: 6, h: 0.3, fontFace: FONT.mono, fontSize: 11, color: COLOR.gray, charSpacing: 1,
  });
  slide.addText(
    [
      { text: "Sprint ", options: { color: COLOR.black } },
      { text: "review", options: { color: COLOR.red } },
    ],
    { isTextBox: true, margin: 0, x: 0.9, y: 2.55, w: 6.2, h: 1.0, fontFace: FONT.sans, fontSize: 54, bold: true, valign: "middle" }
  );
  text(slide, document.header.sprint.name, { x: 0.9, y: 3.65, w: 6.2, h: 0.45, fontSize: 20, bold: true, fit: "shrink" });
  text(slide, `${document.header.boardName} · ${document.header.projectKey} / Board ${document.header.boardId}`, {
    x: 0.9, y: 4.1, w: 6.2, h: 0.3, fontFace: FONT.mono, fontSize: 11, color: COLOR.gray,
  });

  const stats: Array<[string, string]> = [
    [lines.goalStatus, "goal status"],
    [lines.ticketsDone, "tickets done"],
    [formatNumber(document.delivered.points), "points delivered"],
    [lines.daysLeft, "working days left"],
  ];
  stats.forEach(([value, label], index) => {
    const x = 0.9 + index * 1.55;
    text(slide, value, { x, y: 4.85, w: 1.5, h: 0.4, fontFace: FONT.mono, fontSize: 17, bold: true, color: COLOR.red, fit: "shrink" });
    text(slide, label, { x, y: 5.27, w: 1.5, h: 0.22, fontFace: FONT.mono, fontSize: 8, color: COLOR.gray });
  });

  const { label, theme } = parseSprintTheme(document.header.sprint.name);
  if (label) {
    text(slide, label.toUpperCase(), { x: split + 0.55, y: 4.95, w: 5.2, h: 0.3, fontFace: FONT.mono, fontSize: 11, bold: true, color: COLOR.red, charSpacing: 2 });
  }
  text(slide, theme.toUpperCase(), { x: split + 0.55, y: 5.3, w: 5.3, h: 0.95, fontSize: 40, bold: true, color: COLOR.offWhite, valign: "middle", fit: "shrink" });
  slide.addShape("rect", { x: split + 0.58, y: 6.35, w: 0.75, h: 0.07, fill: { color: COLOR.red }, line: { color: COLOR.red, width: 0 } });

  slide.addNotes(
    document.assessment
      ? `Summary (${document.assessment.model}${document.assessment.teamRules ? ", with team rules" : ""}):\n${document.assessment.summary}`
      : "No LLM summary: export without --no-assess, with a model selected in pi."
  );
}

// ── Slide 2: goal ────────────────────────────────────────────────────────────

function targetIcon(slide: Slide, x: number, y: number, size: number, color: string): void {
  for (const ratio of [1, 0.6, 0.2]) {
    const d = size * ratio;
    slide.addShape("ellipse", {
      x: x + (size - d) / 2, y: y + (size - d) / 2, w: d, h: d, fill: { color, transparency: 100 }, line: { color, width: 1.25 },
    });
  }
}

function goalCard(slide: Slide, goal: GoalAssessment, x: number, y: number, w: number, h: number): void {
  const style = STATUS_STYLE[GOAL_ITEM_STYLE[goal.status]];
  const label = goal.source === "llm" && goal.status === "unclear" ? "Unclear" : goal.status === "unclear" ? "Not assessed" : formatGoalItemStatus(goal.status);
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.08, fill: { color: style.fill }, line: { color: style.line, width: 1.5 } });
  targetIcon(slide, x + 0.22, y + 0.2, 0.2, style.text);
  text(slide, label.toUpperCase(), { x: x + 0.52, y: y + 0.2, w: w - 0.75, h: 0.2, fontFace: FONT.mono, fontSize: 9, bold: true, color: style.text, charSpacing: 1, valign: "middle" });
  text(slide, goal.text, { x: x + 0.22, y: y + 0.5, w: w - 0.44, h: 0.36, fontSize: 15, bold: true, fit: "shrink" });
  const details = [goal.rationale, goal.evidence && goal.evidence.length > 0 ? goal.evidence.join(" · ") : ""].filter((part) => part);
  if (details.length > 0 && h > 1.1) {
    slide.addText(
      details.map((part, index) => ({
        text: part,
        options: index === 0 && goal.rationale ? { fontSize: 11, color: COLOR.darkGray, breakLine: index < details.length - 1 } : { fontSize: 9, color: COLOR.gray, fontFace: FONT.mono },
      })),
      { isTextBox: true, margin: 0, x: x + 0.22, y: y + 0.9, w: w - 0.44, h: h - 1.05, fontFace: FONT.sans, valign: "top", fit: "shrink" }
    );
  }
}

function goalSlide(pres: PptxGenJS, document: SprintReviewDocument): void {
  const slide = pres.addSlide();
  const lines = buildSummaryLines(document);
  pageHeader(slide, document, "Sprint goal", "Did we achieve the objective?", `${document.header.sprint.startDate} → ${document.header.sprint.endDate}`);
  kpiRow(slide, [
    { label: "Goal status", value: lines.goalStatus, valueColor: STATUS_STYLE[GOAL_STATUS_STYLE[document.goal.status]].text },
    { label: "Tickets done", value: lines.ticketsDone, sub: lines.cancelled },
    { label: "Points delivered", value: lines.pointsDelivered, sub: lines.averageReliability },
    { label: "Days left", value: lines.daysLeft, sub: "working days" },
  ]);

  let y = BODY_Y;
  if (document.assessment) {
    const source = `Summary · assessed by ${document.assessment.model}${document.assessment.teamRules ? " · with team rules" : ""}`;
    slide.addShape("rect", { x: MARGIN, y, w: CONTENT_W, h: 0.95, fill: { color: COLOR.offWhite }, line: { color: COLOR.offWhite, width: 0 } });
    slide.addShape("rect", { x: MARGIN, y, w: 0.06, h: 0.95, fill: { color: COLOR.red }, line: { color: COLOR.red, width: 0 } });
    text(slide, source.toUpperCase(), { x: MARGIN + 0.25, y: y + 0.1, w: CONTENT_W - 0.4, h: 0.2, fontFace: FONT.mono, fontSize: 8, color: COLOR.gray });
    text(slide, document.assessment.summary, { x: MARGIN + 0.25, y: y + 0.32, w: CONTENT_W - 0.45, h: 0.58, fontSize: 11, color: COLOR.darkGray, fit: "shrink" });
    y += 1.1;
  }

  const goals = document.goal.goals;
  if (goals.length === 0) {
    goalCard(slide, { text: "No sprint goal set.", status: "unclear", source: "rule" }, MARGIN, y, CONTENT_W, 0.95);
  } else {
    const columns = goals.length === 1 ? 1 : 2;
    const rows = Math.ceil(goals.length / columns);
    const gap = 0.2;
    const cardW = (CONTENT_W - gap * (columns - 1)) / columns;
    // Cards only grow when there is an LLM reason to show; plain verdict cards stay compact.
    const hasDetails = goals.some((goal) => goal.rationale || (goal.evidence && goal.evidence.length > 0));
    const cardH = Math.min(hasDetails ? 1.9 : 1.0, (BODY_BOTTOM - y - gap * (rows - 1)) / rows);
    goals.forEach((goal, index) => {
      goalCard(slide, goal, MARGIN + (index % columns) * (cardW + gap), y + Math.floor(index / columns) * (cardH + gap), cardW, cardH);
    });
  }
  text(slide, lines.estimateBasis, { x: MARGIN, y: 7.08, w: CONTENT_W, h: 0.22, fontFace: FONT.mono, fontSize: 8, color: COLOR.gray });

  const assessed = goals.filter((goal) => goal.source === "llm");
  slide.addNotes(
    assessed.length > 0
      ? assessed.map((goal) => `${goal.text} — ${formatGoalItemStatus(goal.status)}: ${goal.rationale ?? ""}`).join("\n")
      : "No LLM goal assessment for this export."
  );
}

// ── Slide 3: delivered ───────────────────────────────────────────────────────

function deliveredSlides(pres: PptxGenJS, document: SprintReviewDocument): void {
  const lines = buildSummaryLines(document);
  const colW = [1.7, 7.6, 1.6, CONTENT_W - 1.7 - 7.6 - 1.6];
  paginate(document.delivered.issues).forEach((page, index) => {
    const slide = pres.addSlide();
    const first = index === 0;
    pageHeader(slide, document, "Delivered", first ? "What did we finish?" : "What did we finish? (continued)", "Child tickets only · cancelled tickets excluded");
    if (first) {
      kpiRow(slide, [
        { label: "Delivered", value: String(document.delivered.tickets), sub: "tickets" },
        { label: "Points", value: formatNumber(document.delivered.points), sub: lines.deliveredDelta },
        { label: "Cancelled", value: String(document.delivered.cancelledCount), sub: "not counted" },
        { label: "Done elsewhere", value: String(document.delivered.doneElsewhereCount), sub: "finished in another sprint" },
      ]);
    }
    const y = first ? BODY_Y : KPI_Y;
    panelTitle(slide, "Delivered tickets", `${document.delivered.tickets} items`, MARGIN, y, CONTENT_W);
    addIssueTable(slide, issueRows(page, "Nothing delivered yet.", true), MARGIN, y + 0.4, colW);
  });
}

// ── Slide 4: slipped ─────────────────────────────────────────────────────────

function slippedSlides(pres: PptxGenJS, document: SprintReviewDocument): void {
  const lines = buildSummaryLines(document);
  const leftW = 7.85;
  const rightX = MARGIN + leftW + 0.3;
  const rightW = CONTENT_W - leftW - 0.3;
  paginate(document.slipped.issues).forEach((page, index) => {
    const slide = pres.addSlide();
    const first = index === 0;
    pageHeader(slide, document, "Slipped", first ? "What is still open?" : "What is still open? (continued)", `Scope change: ${lines.scopeChange}`);
    if (first) {
      kpiRow(slide, [
        { label: "Remaining points", value: formatNumber(document.slipped.remainingPoints) },
        { label: "Almost done", value: String(document.slipped.almostDone), sub: lines.almostDoneStatuses },
        { label: "Not started", value: String(document.slipped.notStarted), sub: `in progress: ${document.slipped.inProgress}` },
        { label: "Unestimated", value: String(document.slipped.unestimated), sub: "no estimate · parents excluded" },
      ]);
    }
    const y = first ? BODY_Y : KPI_Y;
    panelTitle(slide, "Open / carryover", `${lines.ticketsDone} done`, MARGIN, y, leftW);
    addIssueTable(slide, issueRows(page, "No open tickets.", true), MARGIN, y + 0.4, [1.3, 4.35, 1.2, leftW - 1.3 - 4.35 - 1.2]);
    if (first) {
      panelTitle(slide, "Punted", "removed from the sprint", rightX, y, rightW);
      addIssueTable(slide, issueRows(document.slipped.punted.slice(0, FIRST_PAGE_ROWS), "No punted tickets.", false), rightX, y + 0.4, [1.15, rightW - 1.15 - 0.7, 0.7]);
    }
  });
}

// ── Slide 5: trend ───────────────────────────────────────────────────────────

function trendSlide(pres: PptxGenJS, document: SprintReviewDocument): void {
  const slide = pres.addSlide();
  const lines = buildSummaryLines(document);
  const { trend } = document;
  pageHeader(slide, document, "Trend", "How reliable are our commitments?", `Last ${trend.windowSize} closed sprints · reliability = total completed ÷ total committed`);
  kpiRow(slide, [
    { label: "Average completed", value: formatNumber(trend.averageCompleted), sub: "points per sprint" },
    { label: "Average committed", value: formatNumber(trend.averageCommitted), sub: "points per sprint" },
    { label: "Reliability", value: lines.reliability, sub: lines.currentReliability },
    { label: "Window", value: String(trend.windowSize), sub: "closed sprints" },
  ]);

  if (trend.sprints.length === 0) {
    text(slide, "No closed sprints yet.", { x: MARGIN, y: BODY_Y + 0.2, w: CONTENT_W, h: 0.4, fontSize: 14, italic: true, color: COLOR.gray });
    return;
  }

  // Category label carries the sprint's reliability, like the web chart's second line.
  const labels = trend.sprints.map((sprint) => `${sprint.name}\n${formatPercent(sprint.reliabilityPercent)}`);
  const series = [
    { name: "Committed points", labels, values: trend.sprints.map((sprint) => sprint.committed ?? 0) },
    { name: "Completed points", labels, values: trend.sprints.map((sprint) => sprint.completed ?? 0) },
  ];
  const axisText = { catAxisLabelColor: COLOR.darkGray, valAxisLabelColor: COLOR.gray, catAxisLabelFontFace: FONT.sans, valAxisLabelFontFace: FONT.mono };
  const chartOptions: PptxGenJS.IChartOpts = {
    x: MARGIN, y: BODY_Y, w: CONTENT_W, h: BODY_BOTTOM - BODY_Y + 0.2,
    showTitle: true, title: "Committed vs completed points", titleFontFace: FONT.sans, titleFontSize: 12, titleColor: COLOR.black,
    showLegend: true, legendPos: "t", legendFontFace: FONT.mono, legendFontSize: 9, legendColor: COLOR.darkGray,
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, ...axisText,
    valGridLine: { color: COLOR.midGray, size: 0.75 }, catGridLine: { style: "none" }, valAxisMinVal: 0,
    catAxisLineShow: true, valAxisLineShow: false,
  };

  if (trend.averageCompleted !== null) {
    const average = trend.averageCompleted;
    slide.addChart(
      [
        {
          type: pres.ChartType.bar,
          data: series,
          options: { barDir: "col", barGrouping: "clustered", barOverlapPct: 100, barGapWidthPct: 220, chartColors: [COLOR.committed, COLOR.red] },
        },
        {
          type: pres.ChartType.line,
          data: [{ name: `Average completed (${average})`, labels, values: trend.sprints.map(() => average) }],
          options: { chartColors: [COLOR.darkGray], lineSize: 1, lineDataSymbol: "none" },
        },
      ],
      // Combo charts take their options as the 2nd argument at runtime; the typings only describe the 3-argument form.
      chartOptions as unknown as unknown[]
    );
  } else {
    slide.addChart(pres.ChartType.bar, series, {
      ...chartOptions, barDir: "col", barGrouping: "clustered", barOverlapPct: 100, barGapWidthPct: 220, chartColors: [COLOR.committed, COLOR.red],
    });
  }
}

export async function buildSprintReviewPptx(document: SprintReviewDocument): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = `Sprint review — ${document.header.sprint.name}`;
  pres.subject = `${document.header.projectKey} / Board ${document.header.boardId}`;

  coverSlide(pres, document);
  goalSlide(pres, document);
  deliveredSlides(pres, document);
  slippedSlides(pres, document);
  trendSlide(pres, document);

  return (await pres.write({ outputType: "nodebuffer" })) as Buffer;
}

export function buildSprintReviewPptxFileName(endDate: string): string {
  return `Sprint review ${endDate}.pptx`;
}

export async function writeSprintReviewPptxExport(document: SprintReviewDocument): Promise<string> {
  const outputDirectory = resolve(process.cwd(), ".pi", "sprintReviewReports");
  const outputPath = resolve(outputDirectory, buildSprintReviewPptxFileName(document.header.sprint.endDate));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, await buildSprintReviewPptx(document));
  return outputPath;
}

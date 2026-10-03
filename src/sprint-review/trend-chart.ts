// Inline SVG chart for the trend slide: one column per closed sprint, a light track for the committed points
// filled from the baseline by the completed points, plus the team's average completed as a reference line.
// Colors were checked with the dataviz palette validator against the white slide surface.
import type { SprintReviewDocument } from "./document";

const WIDTH = 1200;
const HEIGHT = 300;
const PLOT = { top: 16, right: 24, bottom: 56, left: 48 };
const COLUMN_WIDTH = 24;
const RADIUS = 4;

export const TREND_CHART_COLORS = {
  committed: "#ef8796",
  completed: "#ed1a3a",
  grid: "#e0e0e0",
  reference: "#444444",
  text: "#0a0a0a",
  muted: "#888888",
};

type TrendSprint = SprintReviewDocument["trend"]["sprints"][number];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// Smallest "nice" step (1, 2, 5 × 10^n) giving at most 5 intervals up to max.
function niceStep(max: number): number {
  const rough = max / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= rough) ?? magnitude * 10;
}

// A column with a 4px rounded data-end and a square base on the baseline.
function columnPath(x: number, baseline: number, height: number): string {
  if (height <= 0) {
    return "";
  }
  const radius = Math.min(RADIUS, height, COLUMN_WIDTH / 2);
  const top = baseline - height;
  return [
    `M${round(x)} ${round(baseline)}`,
    `V${round(top + radius)}`,
    `Q${round(x)} ${round(top)} ${round(x + radius)} ${round(top)}`,
    `H${round(x + COLUMN_WIDTH - radius)}`,
    `Q${round(x + COLUMN_WIDTH)} ${round(top)} ${round(x + COLUMN_WIDTH)} ${round(top + radius)}`,
    `V${round(baseline)}`,
    "Z",
  ].join(" ");
}

function truncate(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function tooltip(sprint: TrendSprint): string {
  if (sprint.completed === null || sprint.committed === null) {
    return `${sprint.name} — no estimates`;
  }
  const reliability = sprint.reliabilityPercent === null ? "n/a" : `${sprint.reliabilityPercent}%`;
  return `${sprint.name} — ${sprint.completed} of ${sprint.committed} points (${reliability})`;
}

export function buildTrendChartSvg(trend: SprintReviewDocument["trend"]): string {
  const sprints = trend.sprints;
  if (sprints.length === 0) {
    return "";
  }

  const values = sprints.flatMap((sprint) => [sprint.completed ?? 0, sprint.committed ?? 0]);
  const step = niceStep(Math.max(...values, trend.averageCompleted ?? 0, 1));
  const max = Math.ceil(Math.max(...values, trend.averageCompleted ?? 0, 1) / step) * step;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const baseline = PLOT.top + plotHeight;
  const y = (value: number) => baseline - (value / max) * plotHeight;
  const band = plotWidth / sprints.length;

  const parts: string[] = [];

  for (let tick = 0; tick <= max; tick += step) {
    const tickY = round(y(tick));
    parts.push(`<line x1="${PLOT.left}" x2="${WIDTH - PLOT.right}" y1="${tickY}" y2="${tickY}" stroke="${TREND_CHART_COLORS.grid}" stroke-width="1"/>`);
    parts.push(
      `<text x="${PLOT.left - 10}" y="${tickY + 4}" text-anchor="end" font-size="12" fill="${TREND_CHART_COLORS.muted}" font-family="'JetBrains Mono', monospace">${tick}</text>`
    );
  }

  sprints.forEach((sprint, index) => {
    const center = PLOT.left + band * index + band / 2;
    const x = center - COLUMN_WIDTH / 2;
    const committedPath = columnPath(x, baseline, sprint.committed === null ? 0 : (sprint.committed / max) * plotHeight);
    const completedPath = columnPath(x, baseline, sprint.completed === null ? 0 : (sprint.completed / max) * plotHeight);
    const reliability = sprint.reliabilityPercent === null ? "n/a" : `${sprint.reliabilityPercent}%`;
    const labelLength = Math.max(8, Math.floor(band / 8));

    parts.push(
      `<g class="trend-column"><title>${escapeXml(tooltip(sprint))}</title>`,
      // Hit target: the whole band, larger than the mark.
      `<rect x="${round(PLOT.left + band * index)}" y="${PLOT.top}" width="${round(band)}" height="${plotHeight}" fill="transparent"/>`,
      committedPath ? `<path d="${committedPath}" fill="${TREND_CHART_COLORS.committed}"/>` : "",
      completedPath ? `<path d="${completedPath}" fill="${TREND_CHART_COLORS.completed}"/>` : "",
      `<text x="${round(center)}" y="${baseline + 20}" text-anchor="middle" font-size="13" fill="${TREND_CHART_COLORS.text}" font-family="'Sora', sans-serif">${escapeXml(truncate(sprint.name, labelLength))}</text>`,
      `<text x="${round(center)}" y="${baseline + 38}" text-anchor="middle" font-size="12" fill="${TREND_CHART_COLORS.muted}" font-family="'JetBrains Mono', monospace">${escapeXml(reliability)}</text>`,
      `</g>`
    );
  });

  if (trend.averageCompleted !== null) {
    const averageY = round(y(trend.averageCompleted));
    parts.push(
      `<line x1="${PLOT.left}" x2="${WIDTH - PLOT.right}" y1="${averageY}" y2="${averageY}" stroke="${TREND_CHART_COLORS.reference}" stroke-width="1"/>`,
      // Left end: the first column sits in the middle of its band, so the label never lands on a mark.
      `<text x="${PLOT.left + 6}" y="${averageY - 6}" text-anchor="start" font-size="12" fill="${TREND_CHART_COLORS.reference}" font-family="'JetBrains Mono', monospace">avg ${trend.averageCompleted}</text>`
    );
  }

  parts.push(`<line x1="${PLOT.left}" x2="${WIDTH - PLOT.right}" y1="${baseline}" y2="${baseline}" stroke="${TREND_CHART_COLORS.muted}" stroke-width="1"/>`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(
      `Completed versus committed points for the last ${sprints.length} closed sprints`
    )}">`,
    ...parts,
    `</svg>`,
  ].join("");
}

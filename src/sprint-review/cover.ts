// Generated background art for the deck's cover slide: an inline SVG pattern derived from the sprint name,
// so every sprint gets its own cover and re-exports always produce the same one. The slide shows it faded
// behind the cover text, so the shapes here are drawn at full strength and the template sets the opacity.

// Portrait canvas matching the cover's right panel, so shapes keep their size instead of being cropped.
const WIDTH = 600;
const HEIGHT = 800;

// "currentColor" lets the slide's CSS pick the ink, so the same art works on light or dark panels.
const COLORS = {
  ink: "currentColor",
  muted: "#888888",
  accent: "#ed1a3a",
};

export type CoverStyle = "bands" | "circles" | "blocks";

const STYLES: CoverStyle[] = ["bands", "circles", "blocks"];

// "PI#7 - IP : Orion" → { label: "PI#7 - IP", theme: "Orion" }; names without ":" use the whole name as theme.
export function parseSprintTheme(sprintName: string): { label: string; theme: string } {
  const separator = sprintName.lastIndexOf(":");
  if (separator === -1) {
    return { label: "", theme: sprintName.trim() || "Sprint" };
  }
  const theme = sprintName.slice(separator + 1).trim();
  const label = sprintName.slice(0, separator).trim();
  return theme ? { label, theme } : { label: "", theme: label || "Sprint" };
}

// FNV-1a: a small, stable string hash used as the seed.
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: deterministic pseudo-random numbers in [0, 1) from a seed.
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

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

// Geometry in the 600×800 cover canvas, shared by the web SVG and the native PowerPoint shapes.
// `ink: true` means the panel's text color (currentColor in SVG); otherwise `color` is a fixed hex.
export type CoverShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; ink: boolean; color: string; opacity: number; rotate?: number }
  | { kind: "circle"; cx: number; cy: number; r: number; ink: boolean; color: string; opacity: number; strokeWidth?: number };

export const COVER_CANVAS = { width: WIDTH, height: HEIGHT };

function paint(fill: string): { ink: boolean; color: string } {
  return { ink: fill === COLORS.ink, color: fill === COLORS.ink ? "" : fill };
}

// Bands are drawn rotated around the canvas center; each band becomes a rect rotated around its own center.
function drawBands(random: () => number): CoverShape[] {
  const angle = -20 - Math.floor(random() * 30);
  const radians = (angle * Math.PI) / 180;
  const shapes: CoverShape[] = [];
  let x = -HEIGHT;
  const accentIndex = 2 + Math.floor(random() * 4);
  for (let index = 0; x < WIDTH + HEIGHT; index += 1) {
    const width = 18 + random() * 70;
    const gap = 10 + random() * 40;
    const fill = index === accentIndex ? COLORS.accent : random() < 0.35 ? COLORS.muted : COLORS.ink;
    const opacity = fill === COLORS.accent ? 1 : round(0.35 + random() * 0.5);
    const height = HEIGHT * 3;
    const localCx = x + width / 2 - WIDTH / 2;
    const localCy = -HEIGHT + height / 2 - HEIGHT / 2;
    const cx = WIDTH / 2 + localCx * Math.cos(radians) - localCy * Math.sin(radians);
    const cy = HEIGHT / 2 + localCx * Math.sin(radians) + localCy * Math.cos(radians);
    shapes.push({ kind: "rect", x: round(cx - width / 2), y: round(cy - height / 2), w: round(width), h: height, rotate: angle, opacity, ...paint(fill) });
    x += width + gap;
  }
  return shapes;
}

function drawCircles(random: () => number): CoverShape[] {
  const cx = round(WIDTH * (0.35 + random() * 0.45));
  const cy = round(HEIGHT * (0.2 + random() * 0.25));
  const rings: CoverShape[] = [];
  const count = 7 + Math.floor(random() * 5);
  const accentRing = Math.floor(random() * count);
  for (let index = 0; index < count; index += 1) {
    const r = round(40 + index * (28 + random() * 14));
    const isAccent = index === accentRing;
    rings.push({
      kind: "circle",
      cx,
      cy,
      r,
      strokeWidth: isAccent ? 6 : round(1 + random() * 2.5),
      opacity: isAccent ? 1 : round(0.4 + random() * 0.5),
      ...paint(isAccent ? COLORS.accent : COLORS.ink),
    });
  }
  rings.push({ kind: "circle", cx, cy, r: round(18 + random() * 22), opacity: 1, ...paint(COLORS.accent) });
  return rings;
}

function drawBlocks(random: () => number): CoverShape[] {
  const columns = 6;
  const size = WIDTH / columns;
  const rows = Math.floor((HEIGHT * 0.62) / size);
  const cells: CoverShape[] = [];
  let accents = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = random();
      if (roll < 0.5) {
        continue;
      }
      const isAccent = accents < 3 && roll > 0.93;
      accents += isAccent ? 1 : 0;
      const inset = round(size * (0.06 + random() * 0.12));
      const fill = isAccent ? COLORS.accent : random() < 0.4 ? COLORS.muted : COLORS.ink;
      const opacity = isAccent ? 1 : round(0.35 + random() * 0.5);
      cells.push(
        random() < 0.3
          ? { kind: "circle", cx: round(column * size + size / 2), cy: round(row * size + size / 2), r: round(size / 2 - inset), opacity, ...paint(fill) }
          : { kind: "rect", x: round(column * size + inset), y: round(row * size + inset), w: round(size - inset * 2), h: round(size - inset * 2), opacity, ...paint(fill) }
      );
    }
  }
  return cells;
}

const PATTERNS: Record<CoverStyle, (random: () => number) => CoverShape[]> = {
  bands: drawBands,
  circles: drawCircles,
  blocks: drawBlocks,
};

export function pickCoverStyle(sprintName: string): CoverStyle {
  return STYLES[hashString(parseSprintTheme(sprintName).theme.toLowerCase()) % STYLES.length] ?? "bands";
}

export function buildCoverShapes(sprintName: string): CoverShape[] {
  const { theme } = parseSprintTheme(sprintName);
  // Seed on the theme so sprints sharing a theme share a cover.
  const random = createRandom(hashString(theme.toLowerCase()));
  return PATTERNS[pickCoverStyle(sprintName)](random);
}

function toSvg(shape: CoverShape): string {
  const color = shape.ink ? COLORS.ink : shape.color;
  if (shape.kind === "rect") {
    const rotate = shape.rotate ? ` transform="rotate(${shape.rotate} ${round(shape.x + shape.w / 2)} ${round(shape.y + shape.h / 2)})"` : "";
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" fill="${color}" opacity="${shape.opacity}"${rotate}/>`;
  }
  return shape.strokeWidth
    ? `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="none" stroke="${color}" stroke-width="${shape.strokeWidth}" opacity="${shape.opacity}"/>`
    : `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${color}" opacity="${shape.opacity}"/>`;
}

export function buildCoverSvg(sprintName: string): string {
  const { theme } = parseSprintTheme(sprintName);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${escapeXml(`Cover art for ${theme}`)}">`,
    ...buildCoverShapes(sprintName).map(toSvg),
    `</svg>`,
  ].join("");
}

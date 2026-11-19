// ============================================================================
// CHART DRAWINGS
// What the user draws on the chart to analyse it and plan trades. A drawing is
// kept as times and prices, so it stays put across resolutions, zoom and reloads.
// ============================================================================

export type DrawingTool =
  | "trend"
  | "horizontal"
  | "vertical"
  | "ray"
  | "extended"
  | "arrow"
  | "fib"
  | "channel"
  | "measure"
  | "long"
  | "short"
  | "rectangle"
  | "ellipse"
  | "text";

/** A place on the chart: unix seconds and a price */
export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: number;
  tool: DrawingTool;
  /**
   * horizontal, vertical, text: one point. channel: both ends of its first line, then a point
   * on its second. long, short: entry, target and stop; target and stop share the time the
   * plan ends at. Every other tool: start and end.
   */
  points: DrawingPoint[];
  /** a text note's words */
  text?: string;
}

/** The same place on screen */
export interface Pixel {
  x: number;
  y: number;
}

const POINTS: Record<DrawingTool, number> = {
  horizontal: 1,
  vertical: 1,
  text: 1,
  trend: 2,
  ray: 2,
  extended: 2,
  arrow: 2,
  fib: 2,
  measure: 2,
  rectangle: 2,
  ellipse: 2,
  channel: 3,
  long: 3,
  short: 3,
};

/** Retracement levels, 0 at the start of the move and 1 at its end */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Placed by one click rather than drawn from a start to an end */
export const isSinglePoint = (tool: DrawingTool) => POINTS[tool] === 1;

export const isPosition = (tool: DrawingTool): tool is "long" | "short" => tool === "long" || tool === "short";

/**
 * The points of a drawing drawn from `from` to `to`. A channel's second line runs 60% of the
 * move below its first, and no nearer than `minOffset`. A long or short plan aims as far as
 * the move went in price, and stops at half of that on the other side of the entry.
 */
export const drawnPoints = (tool: DrawingTool, from: DrawingPoint, to: DrawingPoint, minOffset: number): DrawingPoint[] => {
  const reach = Math.abs(to.price - from.price);
  if (tool === "channel") return [from, to, { time: to.time, price: to.price - Math.max(minOffset, reach * 0.6) }];
  if (!isPosition(tool)) return [from, to];
  const side = tool === "long" ? 1 : -1;
  const end = Math.max(from.time, to.time);
  return [
    { time: Math.min(from.time, to.time), price: from.price },
    { time: end, price: from.price + side * reach },
    { time: end, price: from.price - (side * reach) / 2 },
  ];
};

/**
 * The drawing's points after its point `handle` is dragged to `to`. A channel's second line
 * keeps its distance from the first. In a long or short plan the target stays on its side of
 * the entry and the stop on the other, and the plan cannot end before it starts.
 */
export const movePoint = ({ tool, points }: Drawing, handle: number, to: DrawingPoint): DrawingPoint[] => {
  if (tool === "channel") {
    const [from, end, second] = points;
    if (handle === 0) return [to, end, second];
    if (handle === 2) return [from, end, { time: end.time, price: to.price }];
    return [from, to, { time: to.time, price: to.price + second.price - end.price }];
  }
  if (!isPosition(tool)) return points.map((point, i) => (i === handle ? to : point));
  const [entry, target, stop] = points;
  if (handle === 0) {
    const [low, high] = [Math.min(target.price, stop.price), Math.max(target.price, stop.price)];
    return [{ time: Math.min(to.time, target.time), price: Math.min(Math.max(to.price, low), high) }, target, stop];
  }
  // a long's target is above its entry and its stop below; a short is the other way up
  const above = (tool === "long") === (handle === 1);
  const price = above ? Math.max(to.price, entry.price) : Math.min(to.price, entry.price);
  const time = Math.max(to.time, entry.time);
  return [entry, { time, price: handle === 1 ? price : target.price }, { time, price: handle === 2 ? price : stop.price }];
};

/** A plan's reward per unit of risk; null when its stop is at its entry */
export const rewardToRisk = ([entry, target, stop]: DrawingPoint[]): number | null =>
  stop.price === entry.price ? null : Math.abs(target.price - entry.price) / Math.abs(entry.price - stop.price);

/** The move between two points: price change, the same in percent, and the hours it took */
export const measureStats = ([from, to]: DrawingPoint[]) => ({
  change: to.price - from.price,
  changePct: (to.price / from.price - 1) * 100,
  hours: Math.round((Math.abs(to.time - from.time) / 3600) * 10) / 10,
});

/**
 * The stretch of a line that is drawn on a pane `width` wide: a ray runs on past its second
 * point to the pane's edge, an extended line to both edges.
 */
export const lineSegment = (tool: DrawingTool, from: Pixel, to: Pixel, width: number): [Pixel, Pixel] => {
  if (tool !== "ray" && tool !== "extended") return [from, to];
  const slope = (to.y - from.y) / (to.x - from.x || 0.001);
  const at = (x: number) => ({ x, y: from.y + (x - from.x) * slope });
  const forward = at(to.x >= from.x ? width : 0);
  return tool === "ray" ? [from, forward] : [at(to.x >= from.x ? 0 : width), forward];
};

const distanceToSegment = (at: Pixel, a: Pixel, b: Pixel): number => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const along = dx || dy ? Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(at.x - a.x - along * dx, at.y - a.y - along * dy);
};

/**
 * Whether `at` is on the drawing whose points are at `points` on a pane `width` wide. A text
 * note's points are the corners of its box.
 */
export const hitsDrawing = (tool: DrawingTool, points: Pixel[], at: Pixel, width: number, tolerance = 6): boolean => {
  const [a, b, c] = points;
  if (tool === "horizontal") return Math.abs(at.y - a.y) <= tolerance;
  if (tool === "vertical") return Math.abs(at.x - a.x) <= tolerance;
  if (tool === "channel") {
    const offset = c.y - b.y;
    return (
      distanceToSegment(at, a, b) <= tolerance ||
      distanceToSegment(at, { x: a.x, y: a.y + offset }, { x: b.x, y: b.y + offset }) <= tolerance
    );
  }
  if (tool === "trend" || tool === "arrow" || tool === "ray" || tool === "extended") {
    return distanceToSegment(at, ...lineSegment(tool, a, b, width)) <= tolerance;
  }
  if (tool === "ellipse") {
    const [rx, ry] = [Math.abs(b.x - a.x) / 2 + tolerance, Math.abs(b.y - a.y) / 2 + tolerance];
    return ((at.x - (a.x + b.x) / 2) / rx) ** 2 + ((at.y - (a.y + b.y) / 2) / ry) ** 2 <= 1;
  }
  const xs = points.map((point) => point.x);
  if (at.x < Math.min(...xs) - tolerance || at.x > Math.max(...xs) + tolerance) return false;
  // a retracement is hit on its level lines: the space between them stays free for the chart
  if (tool === "fib") return FIB_LEVELS.some((level) => Math.abs(at.y - (a.y + (b.y - a.y) * level)) <= tolerance);
  const ys = points.map((point) => point.y);
  return at.y >= Math.min(...ys) - tolerance && at.y <= Math.max(...ys) + tolerance;
};

const storageKey = (market: string) => `terminal-drawings:${market}`;

/** The drawings saved for `market`, leaving out any this version cannot draw */
export const loadDrawings = (market: string): Drawing[] => {
  try {
    const saved: Drawing[] = JSON.parse(localStorage.getItem(storageKey(market)) ?? "[]");
    return saved.filter((drawing) => Array.isArray(drawing?.points) && drawing.points.length === POINTS[drawing.tool]);
  } catch {
    return [];
  }
};

export const saveDrawings = (market: string, drawings: Drawing[]) =>
  localStorage.setItem(storageKey(market), JSON.stringify(drawings));

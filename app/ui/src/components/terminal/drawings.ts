// ============================================================================
// CHART DRAWINGS
// What the user draws on the chart to analyse it and plan trades. A drawing is
// kept as times and prices, so it stays put across resolutions, zoom and reloads.
// ============================================================================

export type DrawingTool = "trend" | "horizontal" | "fib" | "measure" | "long" | "short";

/** A place on the chart: unix seconds and a price */
export interface DrawingPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: number;
  tool: DrawingTool;
  /**
   * trend, fib, measure: start and end. horizontal: one point, of which the price counts.
   * long, short: entry, target and stop; target and stop share the time the plan ends at.
   */
  points: DrawingPoint[];
}

/** The same place on screen */
export interface Pixel {
  x: number;
  y: number;
}

/** Retracement levels, 0 at the end of the move and 1 at its start */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const isPosition = (tool: DrawingTool): tool is "long" | "short" => tool === "long" || tool === "short";

/** A new long or short plan entered at `entry`: reward twice the risk, `reach` in price and `duration` long */
export const newPosition = (tool: "long" | "short", entry: DrawingPoint, reach: number, duration: number): DrawingPoint[] => {
  const side = tool === "long" ? 1 : -1;
  const time = entry.time + duration;
  return [entry, { time, price: entry.price + side * reach }, { time, price: entry.price - (side * reach) / 2 }];
};

/**
 * The drawing's points after its point `handle` is dragged to `to`. In a long or short plan
 * the target stays on its side of the entry and the stop on the other, and the plan cannot
 * end before it starts.
 */
export const movePoint = ({ tool, points }: Drawing, handle: number, to: DrawingPoint): DrawingPoint[] => {
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

/** A plan's reward and risk as percentages of the entry price, and reward per unit of risk */
export const positionStats = ([entry, target, stop]: DrawingPoint[]) => {
  const reward = (Math.abs(target.price - entry.price) / entry.price) * 100;
  const risk = (Math.abs(entry.price - stop.price) / entry.price) * 100;
  return { reward, risk, ratio: risk > 0 ? reward / risk : null };
};

/** The move between two points: price change, the same in percent, and the time it took */
export const measureStats = ([from, to]: DrawingPoint[], barSeconds: number) => ({
  change: to.price - from.price,
  changePct: (to.price / from.price - 1) * 100,
  bars: Math.round((to.time - from.time) / barSeconds),
  seconds: to.time - from.time,
});

/** "45m", "3h 15m", "2d 4h" */
export const formatDuration = (seconds: number): string => {
  const minutes = Math.round(Math.abs(seconds) / 60);
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
};

const distanceToSegment = (at: Pixel, a: Pixel, b: Pixel): number => {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const along = dx || dy ? Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(at.x - a.x - along * dx, at.y - a.y - along * dy);
};

/** Whether `at` is on the drawing whose points are at `points` on screen */
export const hitsDrawing = (tool: DrawingTool, points: Pixel[], at: Pixel, tolerance = 6): boolean => {
  if (tool === "horizontal") return Math.abs(at.y - points[0].y) <= tolerance;
  if (tool === "trend") return distanceToSegment(at, points[0], points[1]) <= tolerance;
  const xs = points.map((point) => point.x);
  const [left, right] = [Math.min(...xs) - tolerance, Math.max(...xs) + tolerance];
  if (at.x < left || at.x > right) return false;
  if (tool === "fib") {
    // its level lines and the move itself: the space between them stays free for the chart
    const [start, end] = points;
    return (
      distanceToSegment(at, start, end) <= tolerance ||
      FIB_LEVELS.some((level) => Math.abs(at.y - (end.y + (start.y - end.y) * level)) <= tolerance)
    );
  }
  const ys = points.map((point) => point.y);
  return at.y >= Math.min(...ys) - tolerance && at.y <= Math.max(...ys) + tolerance;
};

const storageKey = (market: string) => `terminal-drawings:${market}`;

export const loadDrawings = (market: string): Drawing[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(market)) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

export const saveDrawings = (market: string, drawings: Drawing[]) =>
  localStorage.setItem(storageKey(market), JSON.stringify(drawings));

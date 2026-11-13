import {
  IChartApi,
  IPanePrimitive,
  IPrimitivePaneRenderer,
  ISeriesApi,
  Logical,
  PaneAttachedParameter,
  PrimitiveHoveredItem,
  SeriesType,
  Time,
} from "lightweight-charts";
import {
  Drawing,
  DrawingPoint,
  DrawingTool,
  FIB_LEVELS,
  Pixel,
  drawnPoints,
  hitsDrawing,
  isPosition,
  isSinglePoint,
  lineSegment,
  loadDrawings,
  measureStats,
  movePoint,
  rewardToRisk,
  saveDrawings,
} from "@/components/terminal/drawings";
import { formatPrice, priceDecimals } from "@/components/terminal/format";

/** How close to a drawing's point a press must be to take hold of that point */
const HANDLE_REACH = 8;
const HANDLE_RADIUS = 4;
/** A press that moves further than this before release is a drag from start to end, not a first click */
const DRAG_THRESHOLD = 5;
/** A channel's second line starts at least this many pixels from its first */
const MIN_CHANNEL_OFFSET = 15;
/** One color per retracement level */
const FIB_COLORS = ["#8ba4f0", "#6e9fc3", "#69b9a7", "#c5b478", "#c3a17c", "#bb879d", "#a19bcb"];

/** The colors and font drawings are painted with, resolved from the theme */
export interface DrawingInk {
  line: string;
  label: string;
  fill: string;
  up: string;
  down: string;
  upFill: string;
  downFill: string;
  muted: string;
  /** behind a text note */
  note: string;
  /** inside a selected drawing's handles */
  surface: string;
  font: string;
}

/** The market's drawings, the tool in hand and the selection: what the chart's controls show and change */
export class DrawingStore {
  /** the tool in hand; null is the crosshair, which pans the chart and takes hold of drawings */
  tool: DrawingTool | null = null;
  selected: number | null = null;
  drawings: Drawing[] = [];
  /** where a text note is being written */
  note: DrawingPoint | null = null;
  /** counts the changes: what React subscribes to */
  version = 0;
  private market = "";
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(save: boolean) {
    if (save) saveDrawings(this.market, this.drawings);
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  /** Switch to `market`'s drawings */
  open(market: string) {
    if (market === this.market) return;
    this.market = market;
    this.drawings = loadDrawings(market);
    this.tool = null;
    this.selected = null;
    this.note = null;
    this.changed(false);
  }

  /** Take a tool in hand, or go back to the crosshair with null: nothing stays selected or half written */
  arm(tool: DrawingTool | null) {
    this.tool = tool;
    this.selected = null;
    this.note = null;
    this.changed(false);
  }

  select(id: number | null) {
    if (id === this.selected) return;
    this.selected = id;
    this.changed(false);
  }

  /** The tool stays in hand for the next drawing */
  add(drawing: Drawing) {
    this.drawings = [...this.drawings, drawing];
    this.changed(true);
  }

  /** After a drawing's points were moved */
  moved() {
    this.changed(true);
  }

  /** Open the note editor for a text note at `point` */
  startNote(point: DrawingPoint) {
    this.note = point;
    this.changed(false);
  }

  /** Close the note editor, keeping the note if it has words */
  endNote(text = "") {
    const point = this.note;
    this.note = null;
    if (point && text) this.add({ id: Date.now(), tool: "text", points: [point], text });
    else this.changed(false);
  }

  /** Remove the newest drawing */
  undo() {
    this.drawings = this.drawings.slice(0, -1);
    this.selected = null;
    this.changed(true);
  }

  /** Remove the selected drawing */
  remove() {
    this.drawings = this.drawings.filter((drawing) => drawing.id !== this.selected);
    this.selected = null;
    this.changed(true);
  }

  clear() {
    this.drawings = [];
    this.selected = null;
    this.changed(true);
  }
}

/**
 * Paints the store's drawings on the chart's price pane and lets the pointer draw, select,
 * move and reshape them. A press that lands on a drawing, or is made with a tool in hand,
 * is kept from the chart, which would otherwise scroll.
 */
export class DrawingLayer implements IPanePrimitive<Time> {
  ink?: DrawingInk;
  private requestUpdate = () => {};
  /** the first candle's time and the seconds per candle: how a time maps to a place on the time axis */
  private first?: number;
  private step = 0;
  /** being drawn from `origin`: its end follows the pointer */
  private pending?: Drawing;
  private origin?: DrawingPoint;
  private pressedAt?: Pixel;
  private drag?: { drawing: Drawing; handle: number | null; from: DrawingPoint; original: DrawingPoint[] };
  private engaged = false;
  /** the corners of each text note as last painted: where it can be taken hold of */
  private noteBoxes = new Map<number, Pixel[]>();
  private readonly unsubscribe: () => void;
  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target) => target.useMediaCoordinateSpace(({ context }) => this.paint(context)),
  };
  private readonly views = [{ zOrder: () => "top" as const, renderer: () => this.renderer }];

  constructor(
    private chart: IChartApi,
    private series: ISeriesApi<SeriesType>,
    private element: HTMLElement,
    private store: DrawingStore
  ) {
    chart.panes()[0].attachPrimitive(this);
    element.addEventListener("pointerdown", this.press, true);
    element.addEventListener("mousedown", this.keepFromChart, true);
    element.addEventListener("touchstart", this.keepFromChart, { capture: true, passive: false });
    element.addEventListener("keydown", this.key);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.release);
    window.addEventListener("pointercancel", this.release);
    this.unsubscribe = store.subscribe(() => {
      if (!store.tool) this.pending = undefined;
      this.requestUpdate();
    });
  }

  destroy() {
    this.unsubscribe();
    this.element.removeEventListener("pointerdown", this.press, true);
    this.element.removeEventListener("mousedown", this.keepFromChart, true);
    this.element.removeEventListener("touchstart", this.keepFromChart, true);
    this.element.removeEventListener("keydown", this.key);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.release);
    window.removeEventListener("pointercancel", this.release);
  }

  /** The candles on the chart changed: `first` is the oldest one's time, `step` the seconds per candle */
  setTimeline(first: number | undefined, step: number) {
    this.first = first;
    this.step = step;
    this.requestUpdate();
  }

  attached({ requestUpdate }: PaneAttachedParameter<Time>) {
    this.requestUpdate = requestUpdate;
  }

  paneViews() {
    return this.views;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    if (this.store.tool || !this.hit({ x, y })) return null;
    return { externalId: "drawing", zOrder: "top", cursorStyle: "pointer" };
  }

  private pixel(point: DrawingPoint): Pixel | null {
    if (this.first === undefined || !this.step) return null;
    // a time from another resolution falls between two candles, and the chart places only whole ones
    const logical = (point.time - this.first) / this.step;
    const timeScale = this.chart.timeScale();
    const before = timeScale.logicalToCoordinate(Math.floor(logical) as Logical);
    const after = timeScale.logicalToCoordinate((Math.floor(logical) + 1) as Logical);
    const y = this.series.priceToCoordinate(point.price);
    if (before === null || after === null || y === null) return null;
    return { x: before + (after - before) * (logical - Math.floor(logical)), y };
  }

  private pixels(drawing: Drawing): Pixel[] | null {
    const points = drawing.points.map((point) => this.pixel(point));
    return points.includes(null) ? null : (points as Pixel[]);
  }

  /** The time and price at a place on the pane; the time is that of the candle there */
  private point(at: Pixel): DrawingPoint | null {
    const logical = this.chart.timeScale().coordinateToLogical(at.x);
    const price = this.series.coordinateToPrice(at.y);
    if (this.first === undefined || !this.step || logical === null || price === null) return null;
    return { time: this.first + logical * this.step, price };
  }

  /** Where the pointer is on the price pane; null outside it unless `anywhere` */
  private pointer(event: PointerEvent, anywhere = false): Pixel | null {
    const box = this.element.getBoundingClientRect();
    const { width, height } = this.chart.paneSize(0);
    const at = { x: event.clientX - box.left, y: event.clientY - box.top };
    return anywhere || (at.x >= 0 && at.y >= 0 && at.x <= width && at.y <= height) ? at : null;
  }

  /** The topmost drawing at `at`, and the point of it there if any */
  private hit(at: Pixel): { drawing: Drawing; handle: number | null } | null {
    const { width } = this.chart.paneSize(0);
    for (let i = this.store.drawings.length - 1; i >= 0; i--) {
      const drawing = this.store.drawings[i];
      const points = drawing.tool === "text" ? this.noteBoxes.get(drawing.id) : this.pixels(drawing);
      if (!points) continue;
      // a drawing of one point moves as a whole wherever it is taken
      const handle = isSinglePoint(drawing.tool)
        ? -1
        : points.findIndex((point) => Math.hypot(point.x - at.x, point.y - at.y) <= HANDLE_REACH);
      if (handle >= 0) return { drawing, handle };
      if (hitsDrawing(drawing.tool, points, at, width)) return { drawing, handle: null };
    }
    return null;
  }

  /** The points of the drawing in hand, drawn from where it started to `end` */
  private drawn(end: DrawingPoint): DrawingPoint[] {
    const offset = Math.abs(
      (this.series.coordinateToPrice(0) ?? 0) - (this.series.coordinateToPrice(MIN_CHANNEL_OFFSET) ?? 0)
    );
    return drawnPoints(this.pending!.tool, this.origin!, end, offset);
  }

  private press = (event: PointerEvent) => {
    const at = event.button === 0 ? this.pointer(event) : null;
    if (!at) return;
    const { store } = this;
    const point = this.point(at);
    if (store.tool) {
      this.engage();
      if (!point) return;
      if (this.pending) return this.place(point);
      if (store.tool === "text") return store.startNote(point);
      const id = Date.now();
      if (isSinglePoint(store.tool)) return store.add({ id, tool: store.tool, points: [point] });
      this.origin = point;
      this.pending = { id, tool: store.tool, points: [] };
      this.pending.points = this.drawn(point);
      this.pressedAt = at;
      this.requestUpdate();
      return;
    }
    const hit = this.hit(at);
    if (!hit) return store.select(null);
    this.engage();
    store.select(hit.drawing.id);
    if (point) this.drag = { ...hit, from: point, original: hit.drawing.points };
  };

  private move = (event: PointerEvent) => {
    if (!this.pending && !this.drag) return;
    const point = this.point(this.pointer(event, true)!);
    if (!point) return;
    if (this.pending) {
      this.pending.points = this.drawn(point);
    } else {
      const { drawing, handle, from, original } = this.drag!;
      drawing.points =
        handle === null
          ? original.map((p) => ({ time: p.time + point.time - from.time, price: p.price + point.price - from.price }))
          : movePoint({ ...drawing, points: original }, handle, point);
    }
    this.requestUpdate();
  };

  private release = (event: PointerEvent) => {
    this.engaged = false;
    if (this.drag) {
      this.drag = undefined;
      this.store.moved();
    } else if (this.pending && this.pressedAt) {
      const at = this.pointer(event, true)!;
      const point = event.type === "pointerup" ? this.point(at) : null;
      if (point && Math.hypot(at.x - this.pressedAt.x, at.y - this.pressedAt.y) > DRAG_THRESHOLD) this.place(point);
      this.pressedAt = undefined;
    }
  };

  private place(end: DrawingPoint) {
    const drawing = { ...this.pending!, points: this.drawn(end) };
    this.pending = undefined;
    this.store.add(drawing);
  }

  /** This press is the drawings': the chart must not see it, and the keyboard follows it */
  private engage() {
    this.engaged = true;
    this.element.focus({ preventScroll: true });
  }

  private keepFromChart = (event: Event) => {
    if (!this.engaged) return;
    event.stopPropagation();
    event.preventDefault();
  };

  private key = (event: KeyboardEvent) => {
    if ((event.key === "Delete" || event.key === "Backspace") && this.store.selected !== null) this.store.remove();
  };

  private paint(context: CanvasRenderingContext2D) {
    const { ink, store } = this;
    if (!ink) return;
    const { width, height } = this.chart.paneSize(0);
    context.font = ink.font;
    context.textBaseline = "middle";
    context.textAlign = "left";
    context.lineWidth = 1.25;
    this.noteBoxes.clear();

    const line = (from: Pixel, to: Pixel, color = ink.line, dash: number[] = []) => {
      context.strokeStyle = color;
      context.setLineDash(dash);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    };
    const label = (text: string, x: number, y: number) => {
      context.fillStyle = ink.label;
      context.fillText(text, x, y);
    };
    const box = (a: Pixel, b: Pixel, color: string) => {
      context.fillStyle = color;
      context.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    };
    const outline = (a: Pixel, b: Pixel) => {
      context.strokeStyle = ink.line;
      context.setLineDash([]);
      context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    };
    const dot = ({ x, y }: Pixel, radius: number, color: string, ring = false) => {
      context.beginPath();
      context.arc(x, y, radius, 0, 2 * Math.PI);
      context.fillStyle = color;
      context.fill();
      if (!ring) return;
      context.strokeStyle = ink.line;
      context.setLineDash([]);
      context.stroke();
    };

    for (const drawing of this.pending ? [...store.drawings, this.pending] : store.drawings) {
      const points = this.pixels(drawing);
      if (!points) continue;
      const { tool } = drawing;
      const [a, b, c] = points;
      const prices = drawing.points.map((point) => point.price);
      const left = Math.min(...points.map((point) => point.x));
      const right = Math.max(...points.map((point) => point.x));
      let handles = points;

      if (tool === "horizontal") {
        line({ x: 0, y: a.y }, { x: width, y: a.y }, ink.line, [6, 4]);
        label(formatPrice(prices[0]), 8, a.y - 10);
        handles = [{ x: width / 2, y: a.y }];
      } else if (tool === "vertical") {
        line({ x: a.x, y: 0 }, { x: a.x, y: height }, ink.line, [6, 4]);
        handles = [{ x: a.x, y: height / 2 }];
      } else if (tool === "text") {
        const words = drawing.text ?? "";
        const corners = [
          { x: a.x - 7, y: a.y - 15 },
          { x: a.x + context.measureText(words).width + 11, y: a.y + 10 },
        ];
        box(corners[0], corners[1], ink.note);
        label(words, a.x, a.y - 1);
        this.noteBoxes.set(drawing.id, corners);
        handles = [];
        if (drawing.id === store.selected) outline(corners[0], corners[1]);
      } else if (tool === "rectangle") {
        box(a, b, ink.fill);
        outline(a, b);
      } else if (tool === "ellipse") {
        context.beginPath();
        context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 2 * Math.PI);
        context.fillStyle = ink.fill;
        context.fill();
        context.strokeStyle = ink.line;
        context.setLineDash([]);
        context.stroke();
      } else if (tool === "fib") {
        FIB_LEVELS.forEach((level, i) => {
          const y = a.y + (b.y - a.y) * level;
          line({ x: left, y }, { x: right, y }, FIB_COLORS[i]);
          label(`${level.toFixed(3)}  ${formatPrice(prices[0] + (prices[1] - prices[0]) * level)}`, left + 5, y - 8);
        });
      } else if (isPosition(tool)) {
        const ratio = rewardToRisk(drawing.points);
        box(a, b, ink.upFill);
        box(a, c, ink.downFill);
        line({ x: a.x, y: b.y }, b, ink.up);
        line({ x: a.x, y: c.y }, c, ink.down);
        line(a, { x: b.x, y: a.y }, ink.muted);
        label(`${tool === "long" ? "Long" : "Short"} · R:R ${ratio === null ? "—" : ratio.toFixed(1)}`, a.x + 6, b.y - 10);
      } else if (tool === "measure") {
        const { change, changePct, hours } = measureStats(drawing.points);
        const sign = change >= 0 ? "+" : "";
        box(a, b, ink.fill);
        outline(a, b);
        label(`${sign}${changePct.toFixed(2)}% · ${formatPrice(change, priceDecimals(prices[0]))}`, left + 6, Math.min(a.y, b.y) - 12);
        label(`${hours}h`, left + 6, Math.max(a.y, b.y) + 15);
      } else {
        line(...lineSegment(tool, a, b, width));
        if (tool === "arrow") {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          for (const turn of [-0.45, 0.45]) {
            line(b, { x: b.x - 10 * Math.cos(angle + turn), y: b.y - 10 * Math.sin(angle + turn) });
          }
        }
        if (tool === "channel") {
          const offset = c.y - b.y;
          line({ x: a.x, y: a.y + offset }, { x: b.x, y: b.y + offset });
          line({ x: a.x, y: a.y + offset / 2 }, { x: b.x, y: b.y + offset / 2 }, ink.line, [3, 4]);
        }
        if (tool !== "ray" && tool !== "extended") for (const end of [a, b]) dot(end, 2.5, ink.label);
      }

      if (drawing.id === store.selected) for (const handle of handles) dot(handle, HANDLE_RADIUS, ink.surface, true);
    }
  }
}

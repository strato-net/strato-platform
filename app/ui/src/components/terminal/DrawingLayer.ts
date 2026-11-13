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
  formatDuration,
  hitsDrawing,
  isPosition,
  loadDrawings,
  measureStats,
  movePoint,
  newPosition,
  positionStats,
  saveDrawings,
} from "@/components/terminal/drawings";
import { formatPrice, priceDecimals } from "@/components/terminal/format";

/** How close to a drawing's point a press must be to take hold of that point */
const HANDLE_REACH = 8;
const HANDLE_RADIUS = 4;
/** A press that moves further than this before release is a drag from start to end, not a first click */
const DRAG_THRESHOLD = 5;

/** The colors and font drawings are painted with, resolved from the theme */
export interface DrawingInk {
  line: string;
  surface: string;
  upFill: string;
  downFill: string;
  font: string;
}

/** The market's drawings, the tool in hand and the selection: what the toolbar shows and changes */
export class DrawingStore {
  /** the tool the next click on the chart draws with */
  tool: DrawingTool | null = null;
  selected: number | null = null;
  drawings: Drawing[] = [];
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
    this.changed(false);
  }

  /** Take a tool in hand, or put it down with null; either way nothing stays selected */
  arm(tool: DrawingTool | null) {
    this.tool = tool;
    this.selected = null;
    this.changed(false);
  }

  select(id: number | null) {
    if (id === this.selected) return;
    this.selected = id;
    this.changed(false);
  }

  add(drawing: Drawing) {
    this.drawings = [...this.drawings, drawing];
    this.tool = null;
    this.selected = drawing.id;
    this.changed(true);
  }

  /** After a drawing's points were moved */
  moved() {
    this.changed(true);
  }

  /** Remove the selected drawing, or every drawing when none is selected */
  remove() {
    this.drawings = this.selected === null ? [] : this.drawings.filter((drawing) => drawing.id !== this.selected);
    this.selected = null;
    this.changed(true);
  }
}

/**
 * Paints the store's drawings on the chart's price pane and lets the pointer place, select,
 * move and reshape them. A press that lands on a drawing, or is made with a tool in hand,
 * is kept from the chart, which would otherwise scroll.
 */
export class DrawingLayer implements IPanePrimitive<Time> {
  ink?: DrawingInk;
  private requestUpdate = () => {};
  /** the first candle's time and the seconds per candle: how a time maps to a place on the time axis */
  private first?: number;
  private step = 0;
  /** being placed: its last point follows the pointer */
  private pending?: Drawing;
  private pressedAt?: Pixel;
  private drag?: { drawing: Drawing; handle: number | null; from: DrawingPoint; original: DrawingPoint[] };
  private engaged = false;
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
    for (let i = this.store.drawings.length - 1; i >= 0; i--) {
      const drawing = this.store.drawings[i];
      const points = this.pixels(drawing);
      if (!points) continue;
      // a horizontal line moves as a whole wherever it is taken
      const handle =
        drawing.tool === "horizontal"
          ? -1
          : points.findIndex((point) => Math.hypot(point.x - at.x, point.y - at.y) <= HANDLE_REACH);
      if (handle >= 0) return { drawing, handle };
      if (hitsDrawing(drawing.tool, points, at)) return { drawing, handle: null };
    }
    return null;
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
      const id = Date.now();
      if (store.tool === "horizontal") return store.add({ id, tool: store.tool, points: [point] });
      if (isPosition(store.tool)) {
        // sized to the view: a sixth of the prices on screen away, a fifth of the candles long
        const { height } = this.chart.paneSize(0);
        const prices = Math.abs((this.series.coordinateToPrice(0) ?? 0) - (this.series.coordinateToPrice(height) ?? 0));
        const range = this.chart.timeScale().getVisibleLogicalRange();
        const candles = Math.max(5, Math.round(((range?.to ?? 0) - (range?.from ?? 0)) / 5));
        const points = newPosition(store.tool, point, prices / 6, candles * this.step);
        return store.add({ id, tool: store.tool, points });
      }
      this.pending = { id, tool: store.tool, points: [point, point] };
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
      this.pending.points = [this.pending.points[0], point];
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
    const drawing = { ...this.pending!, points: [this.pending!.points[0], end] };
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
    const { store } = this;
    if (event.key === "Escape") store.arm(null);
    else if ((event.key === "Delete" || event.key === "Backspace") && store.selected !== null) store.remove();
  };

  private paint(context: CanvasRenderingContext2D) {
    const { ink, store } = this;
    if (!ink) return;
    const { width } = this.chart.paneSize(0);
    context.font = ink.font;
    context.textBaseline = "middle";
    context.textAlign = "left";
    context.lineWidth = 1;

    const line = (from: Pixel, to: Pixel, dash: number[] = []) => {
      context.strokeStyle = ink.line;
      context.setLineDash(dash);
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    };
    // a horizontal hairline is sharp only when it runs through the middle of a pixel row
    const level = (y: number, from: number, to: number) =>
      line({ x: from, y: Math.round(y) + 0.5 }, { x: to, y: Math.round(y) + 0.5 });
    const fill = (color: string, a: Pixel, b: Pixel) => {
      context.fillStyle = color;
      context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    const label = (text: string, x: number, y: number, align: "left" | "center" | "right" = "left") => {
      const textWidth = context.measureText(text).width;
      const left = align === "left" ? x : align === "right" ? x - textWidth : x - textWidth / 2;
      context.fillStyle = ink.surface;
      context.fillRect(left - 3, y - 8, textWidth + 6, 16);
      context.fillStyle = ink.line;
      context.fillText(text, left, y);
    };

    for (const drawing of this.pending ? [...store.drawings, this.pending] : store.drawings) {
      const points = this.pixels(drawing);
      if (!points) continue;
      const [a, b, c] = points;
      const prices = drawing.points.map((point) => point.price);

      if (drawing.tool === "trend") {
        line(a, b);
      } else if (drawing.tool === "horizontal") {
        level(a.y, 0, width);
        label(formatPrice(prices[0]), width - 4, a.y - 10, "right");
      } else if (drawing.tool === "fib") {
        line(a, b, [4, 4]);
        for (const fraction of FIB_LEVELS) {
          const y = b.y + (a.y - b.y) * fraction;
          level(y, Math.min(a.x, b.x), Math.max(a.x, b.x));
          label(`${fraction} · ${formatPrice(prices[1] + (prices[0] - prices[1]) * fraction)}`, Math.min(a.x, b.x) + 4, y - 9);
        }
      } else if (drawing.tool === "measure") {
        const { change, changePct, bars, seconds } = measureStats(drawing.points, this.step);
        const up = change >= 0;
        const sign = up ? "+" : "−";
        // the figures sit beyond the end of the move, clear of the box
        const y = b.y + (up ? -12 : 12);
        fill(up ? ink.upFill : ink.downFill, a, b);
        const amount = formatPrice(Math.abs(change), priceDecimals(prices[0]));
        label(`${sign}${amount} (${sign}${Math.abs(changePct).toFixed(2)}%)`, (a.x + b.x) / 2, y + (up ? -16 : 0), "center");
        label(`${Math.abs(bars)} bars · ${formatDuration(seconds)}`, (a.x + b.x) / 2, y + (up ? 0 : 16), "center");
      } else {
        const { reward, risk, ratio } = positionStats(drawing.points);
        const centre = (a.x + b.x) / 2;
        fill(ink.upFill, a, b);
        fill(ink.downFill, a, c);
        level(a.y, a.x, b.x);
        label(`Target ${formatPrice(prices[1])} (${reward.toFixed(2)}%)`, centre, b.y + Math.sign(b.y - a.y) * 11, "center");
        label(`Stop ${formatPrice(prices[2])} (${risk.toFixed(2)}%)`, centre, c.y + Math.sign(c.y - a.y) * 11, "center");
        if (ratio !== null) label(`Risk/reward ${ratio.toFixed(2)}`, centre, a.y, "center");
      }

      if (drawing.id === store.selected || drawing === this.pending) {
        context.setLineDash([]);
        for (const { x, y } of drawing.tool === "horizontal" ? [{ x: width / 2, y: a.y }] : points) {
          context.beginPath();
          context.arc(x, y, HANDLE_RADIUS, 0, 2 * Math.PI);
          context.fillStyle = ink.surface;
          context.fill();
          context.strokeStyle = ink.line;
          context.stroke();
        }
      }
    }
  }
}

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  CandlestickChart,
  ChevronDown,
  LineChart,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  AutoscaleInfoProvider,
  CandlestickData,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineSeries,
  LineStyle,
  SeriesType,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { CandleResolution, MarketCandle } from "@/interface";
import { useMarketCandles } from "@/hooks/terminal/useMarketData";
import { priceDecimals } from "@/components/terminal/format";
import { INDICATORS, Indicator, IndicatorPlot } from "@/components/terminal/indicators";
import { DrawingLayer, DrawingStore } from "@/components/terminal/DrawingLayer";
import { ChartTools, NoteEditor } from "@/components/terminal/ChartTools";
import { ChartLegend } from "@/components/terminal/ChartLegend";

const RESOLUTIONS: CandleResolution[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
/** Stretches of history to jump to: the candles each is read in, and how many of them fill the chart */
const RANGES: { label: string; resolution: CandleResolution; bars: number }[] = [
  { label: "1D", resolution: "5m", bars: 288 },
  { label: "1W", resolution: "1h", bars: 168 },
  { label: "1M", resolution: "1d", bars: 32 },
  { label: "1Y", resolution: "1w", bars: 52 },
  { label: "All", resolution: "1w", bars: Infinity },
];
/** The price as candles, or as a line through the closes */
const CHART_TYPES = [
  { type: "candles", label: "Candles", Icon: CandlestickChart },
  { type: "line", label: "Line", Icon: LineChart },
] as const;
type ChartType = (typeof CHART_TYPES)[number]["type"];
const CHART_TYPE_KEY = "terminal-chart-type";
const INDICATORS_KEY = "terminal-indicators";
const INITIAL_VISIBLE_BARS = 120;
/** Heights of the volume pane and of an indicator's pane, as stretch factors (the price pane's is 2) */
const VOLUME_PANE_STRETCH = 0.25;
const INDICATOR_PANE_STRETCH = 0.5;

const storedIndicators = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(INDICATORS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

/** A theme token resolved to an rgb()/rgba() string the canvas can use */
const themeColor = (token: string, alpha = 1): string => {
  const probe = document.createElement("span");
  probe.style.color = `hsl(var(--${token}) / ${alpha})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};

// the chart's time axis is UTC; shift bucket times so it reads in local time
const LOCAL_OFFSET_SECONDS = new Date().getTimezoneOffset() * 60;
const chartTime = (bucket: number) => (bucket - LOCAL_OFFSET_SECONDS) as UTCTimestamp;

/** Time constant of the price-axis easing */
const AUTOSCALE_EASE_MS = 80;
/** After new data is loaded the library refits over a few frames: those fits are immediate */
const AUTOSCALE_SNAP_MS = 200;

/**
 * The library refits the price axis to the visible bars in a single frame, so a tall bar
 * scrolling into view makes the whole chart jump. This eases the fitted range toward its
 * target instead: each frame an edge closes a fraction of its gap, counting at most half
 * the range on screen as the gap, so a flat market meeting a tall bar zooms out steadily
 * rather than in one step. `reset` makes the next fit immediate (new market or resolution).
 */
const easeAutoscale = (series: ISeriesApi<SeriesType>) => {
  let shown: { minValue: number; maxValue: number } | undefined;
  let target = shown;
  let frame = 0;
  let last = 0;
  let snapUntil = 0;
  const settled = () =>
    !shown || !target || (shown.minValue === target.minValue && shown.maxValue === target.maxValue);
  const provider: AutoscaleInfoProvider = (original) => {
    const info = original();
    if (!info?.priceRange) return info;
    target = info.priceRange;
    if (!shown || performance.now() < snapUntil) shown = target;
    if (!frame && !settled()) {
      last = performance.now();
      frame = requestAnimationFrame(step);
    }
    return { ...info, priceRange: shown };
  };
  const step = (now: number) => {
    frame = 0;
    if (!shown || !target) return;
    const k = 1 - Math.exp(-Math.max(0, now - last) / AUTOSCALE_EASE_MS);
    last = now;
    const reach = (shown.maxValue - shown.minValue) / 2 || Infinity;
    const toward = (from: number, to: number) =>
      from + Math.sign(to - from) * Math.min(Math.abs(to - from), reach) * k;
    const next = {
      minValue: toward(shown.minValue, target.minValue),
      maxValue: toward(shown.maxValue, target.maxValue),
    };
    // within a couple of pixels of the target: land on it and stop
    const gap = Math.abs(next.minValue - target.minValue) + Math.abs(next.maxValue - target.maxValue);
    shown = gap < Math.abs(target.maxValue - target.minValue) * 0.005 ? target : next;
    // re-applying the provider makes the library refit with the eased range; it is asked
    // before the next step is queued so the library draws first on every frame
    series.applyOptions({ autoscaleInfoProvider: provider });
    if (!settled()) frame = requestAnimationFrame(step);
  };
  series.applyOptions({ autoscaleInfoProvider: provider });
  return {
    reset: () => {
      cancelAnimationFrame(frame);
      frame = 0;
      shown = undefined;
      snapUntil = performance.now() + AUTOSCALE_SNAP_MS;
    },
    stop: () => cancelAnimationFrame(frame),
  };
};

/** One plot of an indicator on the chart */
interface DrawnPlot {
  series: ISeriesApi<SeriesType>;
  plot: IndicatorPlot;
  ease?: ReturnType<typeof easeAutoscale>;
  levels: IPriceLine[];
}

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  line: ISeriesApi<"Line">;
  volume: ISeriesApi<"Histogram">;
  /** by indicator id */
  indicators: Map<string, DrawnPlot[]>;
  drawings: DrawingLayer;
  eases: ReturnType<typeof easeAutoscale>[];
  volumeColors: { up: string; down: string };
  /** what the series currently hold: a poll that only extends it is applied in place */
  shown: { key: string; length: number; first?: number };
}

/** Put the newest `bars` of the chart's `candles` on screen */
const showLatest = (chart: IChartApi, candles: number, bars: number) =>
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles - bars), to: candles + 2 });

/** A histogram bar's color: above zero or below it */
const signColor = ({ volumeColors }: ChartHandles, value: number) => (value >= 0 ? volumeColors.up : volumeColors.down);

/** Adds an indicator's plots to the chart: over the price, or in a new pane below the others */
const drawIndicator = (current: ChartHandles, { overlay, range, levels = [], label }: Indicator, plots: IndicatorPlot[]) => {
  const { chart } = current;
  const pane = overlay ? 0 : chart.panes().length;
  const drawn = plots.map((plot, i): DrawnPlot => {
    const options = {
      priceLineVisible: false,
      // the legend names an overlay; a pane is named by the tag on its axis
      lastValueVisible: !overlay && !plot.histogram,
      title: !overlay && i === plots.findIndex((p) => !p.histogram) ? label : "",
    };
    const series = plot.histogram
      ? chart.addSeries(HistogramSeries, options, pane)
      : chart.addSeries(
          LineSeries,
          {
            ...options,
            color: themeColor(plot.color!),
            lineWidth: 1,
            crosshairMarkerVisible: false,
            ...(range && {
              autoscaleInfoProvider: () => ({ priceRange: { minValue: range[0], maxValue: range[1] } }),
            }),
          },
          pane
        );
    // a pane with a fixed range has nothing to refit
    const ease = range ? undefined : easeAutoscale(series);
    if (ease) current.eases.push(ease);
    const guides =
      i === 0
        ? levels.map((price) =>
            series.createPriceLine({
              price,
              color: themeColor("muted-foreground", 0.5),
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
            })
          )
        : [];
    return { series, plot, ease, levels: guides };
  });
  if (!overlay) chart.panes()[pane].setStretchFactor(INDICATOR_PANE_STRETCH);
  return drawn;
};

export const PriceChart = ({ poolAddress }: { poolAddress: string }) => {
  const [resolution, setResolution] = useState<CandleResolution>("15m");
  const [chartType, setChartType] = useState<ChartType>(() =>
    localStorage.getItem(CHART_TYPE_KEY) === "line" ? "line" : "candles"
  );
  const [enabledIndicators, setEnabledIndicators] = useState(storedIndicators);
  const [expanded, setExpanded] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  /** index of the candle under the crosshair */
  const [hovered, setHovered] = useState<number>();
  const [drawings] = useState(() => new DrawingStore());
  useSyncExternalStore(drawings.subscribe, () => drawings.version);
  const { data: candles, isLoading } = useMarketCandles(poolAddress, resolution);
  const containerRef = useRef<HTMLDivElement>(null);
  const handles = useRef<ChartHandles>();
  /** how many candles to open on once the resolution a range switched to has loaded */
  const rangeBars = useRef<number>();

  const indicators = useMemo(() => {
    const rows = candles ?? [];
    const closes = rows.map((row) => row[4]);
    return {
      times: rows.map((row) => chartTime(row[0])),
      precision: priceDecimals(closes.at(-1) ?? 1),
      active: INDICATORS.filter(({ id }) => enabledIndicators.includes(id)).map((indicator) => ({
        indicator,
        plots: indicator.plots(closes),
      })),
    };
  }, [candles, enabledIndicators]);

  // the chart's colors come from the theme tokens. The theme is a class on <html>, set after
  // this component's effects have run, so the tokens are re-read when that class changes
  // rather than when React reports a new theme
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const candleSeries = chart.addSeries(CandlestickSeries);
    const lineSeries = chart.addSeries(LineSeries, { lineWidth: 2 });
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false },
      1
    );
    chart.panes()[1].setStretchFactor(VOLUME_PANE_STRETCH);
    const eases = [easeAutoscale(candleSeries), easeAutoscale(lineSeries), easeAutoscale(volumeSeries)];
    const layer = new DrawingLayer(chart, candleSeries, containerRef.current, drawings);
    const current: ChartHandles = {
      chart,
      candles: candleSeries,
      line: lineSeries,
      volume: volumeSeries,
      indicators: new Map(),
      drawings: layer,
      eases,
      volumeColors: { up: "", down: "" },
      shown: { key: "", length: 0 },
    };
    handles.current = current;

    const applyTheme = () => {
      const up = themeColor("up");
      const down = themeColor("down");
      const border = themeColor("border");
      const grid = themeColor("border", 0.5);
      chart.applyOptions({
        layout: { textColor: themeColor("muted-foreground"), panes: { separatorColor: border } },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { borderColor: border },
        timeScale: { borderColor: border },
      });
      candleSeries.applyOptions({
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
      lineSeries.applyOptions({ color: themeColor("foreground") });
      current.volumeColors = { up: themeColor("up", 0.5), down: themeColor("down", 0.5) };
      // volume bars carry their own color: repaint the ones already drawn
      const bars = candleSeries.data() as CandlestickData[];
      volumeSeries.setData(
        volumeSeries.data().map((bar, index) => ({
          ...bar,
          color: bars[index].close >= bars[index].open ? current.volumeColors.up : current.volumeColors.down,
        }))
      );
      for (const { series, plot, levels } of [...current.indicators.values()].flat()) {
        if (plot.histogram) {
          series.setData(
            series.data().map((bar) => ("value" in bar ? { ...bar, color: signColor(current, bar.value) } : bar))
          );
        } else {
          series.applyOptions({ color: themeColor(plot.color!) });
        }
        levels.forEach((level) => level.applyOptions({ color: themeColor("muted-foreground", 0.5) }));
      }
      layer.ink = {
        line: themeColor("drawing"),
        label: themeColor("drawing-label"),
        fill: themeColor("drawing", 0.09),
        up,
        down,
        upFill: themeColor("up", 0.15),
        downFill: themeColor("down", 0.15),
        muted: themeColor("muted-foreground"),
        note: themeColor("muted", 0.9),
        surface: themeColor("background"),
        font: `10px ${getComputedStyle(document.body).fontFamily}`,
      };
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    chart.subscribeCrosshairMove((param) => setHovered(param.point ? param.logical : undefined));
    // Escape steps back from everything at once: the tools, the tool in hand, the full window
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      setExpanded(false);
      drawings.arm(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      themeObserver.disconnect();
      eases.forEach((ease) => ease.stop());
      layer.destroy();
      chart.remove();
      handles.current = undefined;
    };
  }, [drawings]);

  // both series hold the data; the chart type decides which one is drawn
  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    current.candles.applyOptions({ visible: chartType === "candles" });
    current.line.applyOptions({ visible: chartType === "line" });
    // a line spans only the closes, candles the highs and lows: fit the new one at once
    current.eases.forEach((ease) => ease.reset());
  }, [chartType]);

  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    const rows = candles ?? [];
    const key = `${poolAddress}:${resolution}`;
    const candle = ([t, open, high, low, close]: MarketCandle) => ({ time: chartTime(t), open, high, low, close });
    const point = (row: MarketCandle) => ({ time: chartTime(row[0]), value: row[4] });
    const volume = ([t, open, , , close, quoteVolume]: MarketCandle) => ({
      time: chartTime(t),
      value: quoteVolume,
      color: close >= open ? current.volumeColors.up : current.volumeColors.down,
    });

    const { shown } = current;
    if (shown.key === key && shown.length > 0 && rows.length >= shown.length && rows[0][0] === shown.first) {
      // a poll only changes the newest bars: apply those in place, the view stays put
      for (const row of rows.slice(shown.length - 1)) {
        current.candles.update(candle(row));
        current.line.update(point(row));
        current.volume.update(volume(row));
      }
    } else {
      const precision = priceDecimals(rows[rows.length - 1]?.[4] ?? 1);
      const priceFormat = { type: "price" as const, precision, minMove: 10 ** -precision };
      current.candles.applyOptions({ priceFormat });
      current.line.applyOptions({ priceFormat });
      current.candles.setData(rows.map(candle));
      current.line.setData(rows.map(point));
      current.volume.setData(rows.map(volume));
      if (rows.length > 0 && shown.key !== key) {
        // open on the most recent bars; the rest of the history is a scroll away
        showLatest(current.chart, rows.length, rangeBars.current ?? INITIAL_VISIBLE_BARS);
        rangeBars.current = undefined;
      }
      // new data fits at once; only later refits ease
      current.eases.forEach((ease) => ease.reset());
    }
    current.shown = { key: rows.length > 0 ? key : shown.key, length: rows.length, first: rows[0]?.[0] };
    drawings.open(poolAddress);
    current.drawings.setTimeline(rows[0]?.[0], rows.length > 1 ? rows[1][0] - rows[0][0] : 0);
  }, [candles, poolAddress, resolution, drawings]);

  // indicators are recomputed from the candles on every poll and redrawn whole
  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    const { chart, indicators: drawn } = current;
    const { times, precision, active } = indicators;
    for (const [id, plots] of drawn) {
      if (active.some(({ indicator }) => indicator.id === id)) continue;
      for (const { series, ease } of plots) {
        if (ease) {
          ease.stop();
          current.eases.splice(current.eases.indexOf(ease), 1);
        }
        chart.removeSeries(series);
      }
      drawn.delete(id);
    }
    for (const { indicator, plots } of active) {
      if (!drawn.has(indicator.id)) drawn.set(indicator.id, drawIndicator(current, indicator, plots));
      // an indicator in its own pane is a difference of prices: finer than the prices themselves
      const decimals = indicator.overlay ? precision : precision + 2;
      drawn.get(indicator.id)!.forEach(({ series }, i) => {
        if (!indicator.range) {
          series.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 10 ** -decimals } });
        }
        series.setData(
          times.map((time, j) => {
            const value = plots[i].values[j];
            if (value === null) return { time };
            return plots[i].histogram ? { time, value, color: signColor(current, value) } : { time, value };
          })
        );
      });
    }
  }, [indicators]);

  const toggleIndicator = (id: string) => {
    const next = enabledIndicators.includes(id) ? enabledIndicators.filter((other) => other !== id) : [...enabledIndicators, id];
    localStorage.setItem(INDICATORS_KEY, JSON.stringify(next));
    setEnabledIndicators(next);
  };

  const showRange = (range: (typeof RANGES)[number]) => {
    if (range.resolution !== resolution) {
      rangeBars.current = range.bars;
      setResolution(range.resolution);
    } else if (handles.current && candles?.length) {
      showLatest(handles.current.chart, candles.length, range.bars);
    }
  };

  const shownIndex = hovered !== undefined && candles?.[hovered] ? hovered : (candles?.length ?? 0) - 1;

  return (
    <div className={`flex flex-col ${expanded ? "fixed inset-0 z-[60] bg-background" : "h-full"}`}>
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 text-xs">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => {
              rangeBars.current = undefined;
              setResolution(r);
            }}
            className={`rounded px-2 py-0.5 ${
              r === resolution ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
        <button
          onClick={() => setToolsOpen(!toolsOpen)}
          aria-expanded={toolsOpen}
          aria-label="Tools & Indicators"
          className={`ml-2 flex items-center gap-[7px] whitespace-nowrap rounded border bg-muted/50 px-2 py-1.5 ${
            toolsOpen ? "border-drawing/60 text-drawing" : "border-border text-foreground/70"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Tools &amp; Indicators</span>
          <ChevronDown className="h-[11px] w-[11px]" />
        </button>
        <div className="ml-auto flex items-center gap-1">
          {[
            { label: "Undo Drawing", Icon: Undo2, run: () => drawings.undo() },
            { label: "Clear Drawings", Icon: Trash2, run: () => drawings.clear() },
          ].map(({ label, Icon, run }) => (
            <button
              key={label}
              onClick={run}
              disabled={drawings.drawings.length === 0}
              aria-label={label}
              title={label}
              className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:hover:text-muted-foreground"
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          {CHART_TYPES.map(({ type, label, Icon }) => (
            <button
              key={type}
              onClick={() => {
                localStorage.setItem(CHART_TYPE_KEY, type);
                setChartType(type);
              }}
              aria-label={label}
              aria-pressed={type === chartType}
              title={label}
              className={`rounded p-1 ${
                type === chartType ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            title={expanded ? "Exit full screen" : "Full screen"}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* isolated: the chart library layers its pane dividers high enough to show through what is laid over the chart */}
        <div ref={containerRef} tabIndex={-1} className="absolute inset-0 isolate outline-none" />
        <ChartLegend candle={candles?.[shownIndex]} index={shownIndex} indicators={indicators.active} />
        {(isLoading || candles?.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {isLoading ? "Loading chart…" : "No trades yet"}
          </div>
        )}
        {toolsOpen && (
          <ChartTools
            store={drawings}
            indicators={enabledIndicators}
            onIndicator={toggleIndicator}
            onClose={() => setToolsOpen(false)}
          />
        )}
        {drawings.note && <NoteEditor store={drawings} />}
      </div>
      <div className="flex h-[37px] items-center gap-2 border-t border-border px-3 text-[10px]">
        {RANGES.map((range) => (
          <button
            key={range.label}
            onClick={() => showRange(range)}
            className="p-[3px] text-muted-foreground hover:text-foreground"
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
};

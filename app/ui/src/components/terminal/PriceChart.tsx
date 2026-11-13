import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  AutoscaleInfoProvider,
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  SeriesType,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { CandleResolution, MarketCandle } from "@/interface";
import { useMarketCandles } from "@/hooks/terminal/useMarketData";

const RESOLUTIONS: CandleResolution[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const INITIAL_VISIBLE_BARS = 120;

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

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  eases: ReturnType<typeof easeAutoscale>[];
  volumeColors: { up: string; down: string };
  /** what the series currently hold: a poll that only extends it is applied in place */
  shown: { key: string; length: number; first?: number };
}

export const PriceChart = ({ poolAddress }: { poolAddress: string }) => {
  const [resolution, setResolution] = useState<CandleResolution>("15m");
  const { data: candles, isLoading } = useMarketCandles(poolAddress, resolution);
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const handles = useRef<ChartHandles>();

  // the chart is rebuilt on theme change: its colors are resolved from the theme tokens
  useEffect(() => {
    if (!containerRef.current) return;
    const up = themeColor("up");
    const down = themeColor("down");
    const grid = themeColor("border", 0.5);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: themeColor("muted-foreground"),
        panes: { separatorColor: themeColor("border") },
      },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: themeColor("border") },
      timeScale: { borderColor: themeColor("border"), timeVisible: true, secondsVisible: false },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
    });
    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false },
      1
    );
    chart.panes()[1].setStretchFactor(0.25);
    const eases = [easeAutoscale(candleSeries), easeAutoscale(volumeSeries)];
    handles.current = {
      chart,
      candles: candleSeries,
      volume: volumeSeries,
      eases,
      volumeColors: { up: themeColor("up", 0.5), down: themeColor("down", 0.5) },
      shown: { key: "", length: 0 },
    };
    return () => {
      eases.forEach((ease) => ease.stop());
      chart.remove();
      handles.current = undefined;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    const rows = candles ?? [];
    const key = `${poolAddress}:${resolution}`;
    const candle = ([t, open, high, low, close]: MarketCandle) => ({ time: chartTime(t), open, high, low, close });
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
        current.volume.update(volume(row));
      }
    } else {
      const last = rows[rows.length - 1]?.[4] ?? 1;
      const precision = last >= 1000 ? 2 : last >= 1 ? 4 : 6;
      current.candles.applyOptions({ priceFormat: { type: "price", precision, minMove: 10 ** -precision } });
      current.candles.setData(rows.map(candle));
      current.volume.setData(rows.map(volume));
      if (rows.length > 0 && shown.key !== key) {
        // open on the most recent bars; the rest of the history is a scroll away
        current.chart
          .timeScale()
          .setVisibleLogicalRange({ from: Math.max(0, rows.length - INITIAL_VISIBLE_BARS), to: rows.length + 2 });
      }
      // new data fits at once; only later refits ease
      current.eases.forEach((ease) => ease.reset());
    }
    current.shown = { key: rows.length > 0 ? key : shown.key, length: rows.length, first: rows[0]?.[0] };
  }, [candles, poolAddress, resolution, resolvedTheme]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 px-3 py-2 text-xs">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setResolution(r)}
            className={`rounded px-2 py-0.5 ${
              r === resolution ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {(isLoading || candles?.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {isLoading ? "Loading chart…" : "No trades yet"}
          </div>
        )}
      </div>
    </div>
  );
};

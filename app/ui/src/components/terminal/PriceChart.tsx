import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  CandlestickSeries,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { CandleResolution } from "@/interface";
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

interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  /** pool + resolution the view was last fitted to */
  fitted: string;
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
    handles.current = { chart, candles: candleSeries, volume: volumeSeries, fitted: "" };
    return () => {
      chart.remove();
      handles.current = undefined;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const current = handles.current;
    if (!current) return;
    const rows = candles ?? [];
    const last = rows[rows.length - 1]?.[4] ?? 1;
    const precision = last >= 1000 ? 2 : last >= 1 ? 4 : 6;
    current.candles.applyOptions({ priceFormat: { type: "price", precision, minMove: 10 ** -precision } });
    current.candles.setData(
      rows.map(([t, open, high, low, close]) => ({
        time: (t - LOCAL_OFFSET_SECONDS) as UTCTimestamp,
        open,
        high,
        low,
        close,
      }))
    );
    current.volume.setData(
      rows.map(([t, open, , , close, volume]) => ({
        time: (t - LOCAL_OFFSET_SECONDS) as UTCTimestamp,
        value: volume,
        color: themeColor(close >= open ? "up" : "down", 0.5),
      }))
    );
    const key = `${poolAddress}:${resolution}`;
    if (rows.length > 0 && current.fitted !== key) {
      // open on the most recent bars; the rest of the history is a scroll away
      current.chart.timeScale().setVisibleLogicalRange({ from: rows.length - INITIAL_VISIBLE_BARS, to: rows.length + 2 });
      current.fitted = key;
    }
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

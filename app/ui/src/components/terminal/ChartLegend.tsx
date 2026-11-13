import { MarketCandle } from "@/interface";
import { Indicator, IndicatorPlot } from "@/components/terminal/indicators";
import { formatPrice, priceDecimals } from "@/components/terminal/format";

interface ChartLegendProps {
  /** the candle under the crosshair, or the newest one */
  candle?: MarketCandle;
  /** its place among the candles */
  index: number;
  indicators: { indicator: Indicator; plots: IndicatorPlot[] }[];
}

/** The candle's prices and each indicator's values there, over the chart's top left corner */
export const ChartLegend = ({ candle, index, indicators }: ChartLegendProps) => {
  if (!candle) return null;
  const [, open, high, low, close] = candle;
  const decimals = priceDecimals(close);
  const change = Number(((close / open - 1) * 100).toFixed(2));

  return (
    <div className="pointer-events-none absolute left-2 right-24 top-1 z-10 flex flex-wrap gap-x-2.5 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
      {(
        [
          ["O", open],
          ["H", high],
          ["L", low],
          ["C", close],
        ] as const
      ).map(([name, price]) => (
        <span key={name}>
          {name} <span className="text-foreground">{formatPrice(price, decimals)}</span>
        </span>
      ))}
      <span className={change > 0 ? "text-up" : change < 0 ? "text-down" : undefined}>
        {change > 0 ? "+" : ""}
        {change.toFixed(2)}%
      </span>
      {indicators.map(({ indicator, plots }) => {
        // lines before a histogram: MACD reads line, signal, difference
        const lines = plots.filter((plot) => !plot.histogram);
        const [marked] = lines;
        return (
          <span key={indicator.id} className="flex items-center gap-1">
            <span className="w-4 border-t-2" style={{ borderColor: `hsl(var(--${marked.color}))` }} />
            {indicator.label}
            <span className="text-foreground">
              {[...lines, ...plots.filter((plot) => plot.histogram)]
                .map((plot) => plot.values[index])
                .filter((value) => value !== null)
                .map((value) => formatPrice(value, indicator.range ? 2 : indicator.overlay ? decimals : decimals + 2))
                .join("  ")}
            </span>
          </span>
        );
      })}
    </div>
  );
};

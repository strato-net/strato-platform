import { useMemo } from "react";
import { formatUnits } from "ethers";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { YieldVaultHistoryPoint } from "@/context/YieldVaultContext";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";

type ChartPoint = {
  timestamp: number;
  value: number;
};

type Props = {
  history: YieldVaultHistoryPoint[];
  currentExchangeRate: string;
  currentTvlUsd: string;
  assetSymbol: string;
  loading: boolean;
};

const parseWad = (value: string): number => {
  try {
    return Number(formatUnits(value || "0", 18));
  } catch {
    return 0;
  }
};

const appendCurrentPoint = (points: ChartPoint[], value: number): ChartPoint[] => {
  if (value <= 0) return points;
  return [...points, { timestamp: Date.now(), value }];
};

const getDomain = (points: ChartPoint[]): [number, number] => {
  const values = points.map(({ value }) => value).filter((value) => value > 0);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const padding = range > 0 ? range * 0.2 : min * 0.001;
  return [Math.max(0, min - padding), max + padding];
};

const getPerformance = (points: ChartPoint[], days?: number): number | null => {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const cutoff = days ? latest.timestamp - days * 24 * 60 * 60 * 1000 : 0;
  const start = days
    ? points.find(({ timestamp }) => timestamp >= cutoff) || points[0]
    : points[0];
  if (start.value <= 0 || latest.timestamp <= start.timestamp) return null;
  return ((latest.value / start.value) - 1) * 100;
};

const formatPerformance = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const HistoryChart = ({
  title,
  value,
  subtitle,
  data,
  loading,
  valueFormatter,
  tickFormatter,
}: {
  title: string;
  value: string;
  subtitle: string;
  data: ChartPoint[];
  loading: boolean;
  valueFormatter: (value: number) => string;
  tickFormatter: (value: number) => string;
}) => (
  <Card className="border border-border/70">
    <CardContent className="pt-4 space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold">{loading ? "..." : value}</p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="h-[220px] w-full">
        {data.length > 1 ? (
          <ChartContainer
            config={{
              value: {
                color: "hsl(var(--primary))",
              },
            }}
            className="h-full w-full"
          >
            <LineChart data={data} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={formatDate}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={72}
                domain={getDomain(data)}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(chartValue) => tickFormatter(Number(chartValue))}
              />
              <ChartTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as ChartPoint;
                  return (
                    <div className="rounded-lg border border-border bg-popover p-3 text-sm shadow-lg">
                      <p className="text-xs text-muted-foreground">{formatDate(point.timestamp)}</p>
                      <p className="mt-1 font-semibold text-popover-foreground">
                        {valueFormatter(point.value)}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: "var(--color-value)" }}
                animationDuration={350}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md bg-muted/30 text-sm text-muted-foreground">
            {loading ? "Loading history..." : "No history yet"}
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);

export const YieldVaultHistoryCharts = ({
  history,
  currentExchangeRate,
  currentTvlUsd,
  assetSymbol,
  loading,
}: Props) => {
  const exchangeData = useMemo(
    () =>
      appendCurrentPoint(
        history
          .map(({ timestamp, exchangeRate }) => ({ timestamp, value: parseWad(exchangeRate) }))
          .filter(({ timestamp, value }) => timestamp > 0 && value > 0)
          .sort((a, b) => a.timestamp - b.timestamp),
        parseWad(currentExchangeRate)
      ),
    [currentExchangeRate, history]
  );
  const tvlData = useMemo(
    () =>
      appendCurrentPoint(
        history
          .map(({ timestamp, tvlUsd }) => ({ timestamp, value: parseWad(tvlUsd) }))
          .filter(({ timestamp, value }) => timestamp > 0 && value > 0)
          .sort((a, b) => a.timestamp - b.timestamp),
        parseWad(currentTvlUsd)
      ),
    [currentTvlUsd, history]
  );

  const formatUsd = (value: number) =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Vault Performance</h2>
          <p className="text-sm text-muted-foreground">Historical share value and total value locked</p>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>7D {formatPerformance(getPerformance(exchangeData, 7))}</span>
          <span>30D {formatPerformance(getPerformance(exchangeData, 30))}</span>
          <span>All {formatPerformance(getPerformance(exchangeData))}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <HistoryChart
          title="Share Value"
          value={`${parseWad(currentExchangeRate).toFixed(4)} ${assetSymbol}`}
          subtitle={`Redeemable ${assetSymbol} per vault share`}
          data={exchangeData}
          loading={loading}
          valueFormatter={(value) => `${value.toFixed(6)} ${assetSymbol}`}
          tickFormatter={(value) => value.toFixed(4)}
        />
        <HistoryChart
          title="TVL"
          value={formatUsd(parseWad(currentTvlUsd))}
          subtitle="Total value locked"
          data={tvlData}
          loading={loading}
          valueFormatter={formatUsd}
          tickFormatter={(value) =>
            Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD" }).format(value)
          }
        />
      </div>
    </section>
  );
};

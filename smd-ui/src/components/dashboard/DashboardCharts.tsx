import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Single validated series hue (defined in index.css for light/dark surfaces).
// These dashboards compare magnitudes, not identities, so one hue is the rule —
// category identity lives in the labels, never in a color cycle.
const SERIES = "hsl(var(--chart-1))";

interface XYPoint {
  x: number;
  y: number;
  /** Actual block number for this bar (the x axis uses the relative index). */
  block?: number;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

/** Shared single-line tooltip shell (avoids recharts' default two-line label/value layout). */
function TooltipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      {children}
    </div>
  );
}

function BarTooltip({
  active,
  payload,
  label,
  unit,
  seriesLabel,
}: {
  active?: boolean;
  payload?: { value?: number; payload?: { block?: number } }[];
  label?: string | number;
  unit?: string;
  seriesLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  const block = payload[0]?.payload?.block ?? label;
  return (
    <TooltipBox>
      <span className="text-muted-foreground">Block #{block} · </span>
      <span className="font-medium">
        {value} {unit ?? seriesLabel}
      </span>
    </TooltipBox>
  );
}

export function BarSeriesCard({
  title,
  data,
  unit,
  seriesLabel,
}: {
  title: string;
  data: XYPoint[];
  unit?: string;
  seriesLabel: string;
}) {
  return (
    <ChartCard title={title}>
      {data.length === 0 ? (
        <EmptyChart message="Waiting for block data…" />
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid
                vertical={false}
                stroke="hsl(var(--border))"
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="block"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                stroke="hsl(var(--muted-foreground))"
                minTickGap={32}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                stroke="hsl(var(--muted-foreground))"
                allowDecimals={!!unit}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                content={({ active, payload, label }) => (
                  <BarTooltip
                    active={active}
                    payload={payload as { value?: number; payload?: { block?: number } }[]}
                    label={label}
                    unit={unit}
                    seriesLabel={seriesLabel}
                  />
                )}
              />
              <Bar dataKey="y" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

export interface CategoryDatum {
  name: string;
  value: number;
}

/**
 * Horizontal top-categories list: label · track bar · count. One hue, direct
 * labels on every row (so no legend or tooltip is needed), tail folded into
 * "Other" past `maxRows`. Replaces the previous multi-hue pie.
 */
export function CategoryBarCard({
  title,
  data,
  maxRows = 6,
  emptyMessage = "No transactions yet.",
}: {
  title: string;
  data: CategoryDatum[];
  maxRows?: number;
  emptyMessage?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const top = data.slice(0, maxRows);
  const tail = data.slice(maxRows);
  const rows =
    tail.length > 0
      ? [...top, { name: `Other (${tail.length})`, value: tail.reduce((s, d) => s + d.value, 0) }]
      : top;
  const max = rows.reduce((m, d) => Math.max(m, d.value), 0);

  return (
    <ChartCard title={title}>
      {rows.length === 0 ? (
        <EmptyChart message={emptyMessage} />
      ) : (
        <div className="flex h-56 flex-col justify-center gap-3">
          {rows.map((d) => {
            const pctOfTotal = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <div key={d.name} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3">
                <span className="truncate font-mono text-xs" title={d.name}>
                  {d.name}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${max > 0 ? Math.max((d.value / max) * 100, 2) : 0}%`,
                      background: SERIES,
                    }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {d.value} · {pctOfTotal}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

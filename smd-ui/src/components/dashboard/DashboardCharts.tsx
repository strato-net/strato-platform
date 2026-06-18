import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Muted, desaturated palette tuned to the app's deep-blue profile (primary 223 75% 40%).
// Distinct enough to read as categories without the neon brightness of the defaults.
const PALETTE = [
  "#3452FE",
  "#6050dc",
  "#d52db7",
  "#ff2e7e",
  "#ff6b45",
  "#ffab05",
  "#dfeb25",
  "#bfff45",
  "#9fff65",
  "#7fff85",
];

interface XYPoint {
  x: number;
  y: number;
  /** Actual block number for this bar (the x axis uses the relative index). */
  block?: number;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      {/* Each chart sizes its own plot area so a legend can sit below without overflowing. */}
      <CardContent>{children}</CardContent>
    </Card>
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
      <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <XAxis dataKey="x" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
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
          <Bar dataKey="y" fill="#3452FE" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export interface PieDatum {
  name: string;
  value: number;
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { fill?: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const color = entry?.payload?.fill;
  return (
    <TooltipBox>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-muted-foreground">{entry?.name}:</span>
        <span className="font-medium">{entry?.value}</span>
      </span>
    </TooltipBox>
  );
}

export function TxTypePieCard({ title, data }: { title: string; data: PieDatum[] }) {
  const pieData = data.map((d, i) => ({ ...d, fill: PALETTE[i % PALETTE.length] }));
  return (
    <ChartCard title={title}>
      {pieData.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          No transactions yet.
        </div>
      ) : (
        <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={2}
            >
              {pieData.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => (
                <PieTooltip
                  active={active}
                  payload={
                    payload as { name?: string; value?: number; payload?: { fill?: string } }[]
                  }
                />
              )}
            />
          </PieChart>
        </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {pieData.map((d) => (
          <span key={d.name} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.fill }} />
            {d.name} ({d.value})
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

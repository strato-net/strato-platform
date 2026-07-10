import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PortfolioGroup } from "@/interface/portfolio";

interface Props {
  groups: PortfolioGroup[];
  isLoading: boolean;
}

// Distinct, colorblind-friendly-ish palette; cycles for long tails.
const COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#ef4444", // red
  "#84cc16", // lime
];

const usd = (v: number): string =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PortfolioAllocationChart = ({ groups, isLoading }: Props) => {
  const data = useMemo(
    () =>
      groups
        .filter((g) => g.grossValueUsd > 0)
        .map((g) => ({ name: g.label, value: g.grossValueUsd, pct: g.allocationPct })),
    [groups]
  );

  return (
    <Card className="rounded-xl shadow-sm mb-6 h-full">
      <CardHeader className="pb-2 md:pb-4">
        <CardTitle className="text-base md:text-lg font-semibold">Allocation</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && data.length === 0 ? (
          <Skeleton className="h-[220px] w-full rounded-lg" />
        ) : data.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
            No allocation to display
          </div>
        ) : (
          <>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [usd(value), name]}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 space-y-1.5">
              {data.map((d, i) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: COLORS[i % COLORS.length] }}
                    />
                    <span className="truncate text-foreground">{d.name}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {d.pct.toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PortfolioAllocationChart;

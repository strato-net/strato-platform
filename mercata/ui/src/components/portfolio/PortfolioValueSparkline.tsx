import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { api } from "@/lib/axios";

interface Props {
  /** Current portfolio value; the sample curve ends here. */
  currentValue: number;
  /** Trend color: green when up, red when down. */
  positive: boolean;
  enabled: boolean;
}

type Point = { i: number; v: number };

/** Deterministic sample series ending at `end` (used until real history exists). */
const sampleSeries = (end: number, n = 40): Point[] => {
  const safeEnd = end > 0 ? end : 1000;
  const start = safeEnd * 0.35;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start + (safeEnd - start) * Math.pow(t, 1.3);
    const wiggle = (Math.sin(i * 0.9) + Math.sin(i * 0.37)) * (safeEnd * 0.02);
    pts.push({ i, v: Math.max(0, base + wiggle) });
  }
  pts[n - 1].v = safeEnd;
  return pts;
};

/**
 * Compact portfolio-value sparkline for the overview card. Tries the real
 * net-balance history endpoint; if it returns nothing (e.g. running against a
 * remote node with no local cirrus DB), falls back to an illustrative sample
 * curve so the layout is reviewable.
 */
const PortfolioValueSparkline = ({ currentValue, positive, enabled }: Props) => {
  const [real, setReal] = useState<Point[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .get("/tokens/v2/net-balance-history", { params: { duration: "1m" } })
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : res.data?.data;
        if (!cancelled && Array.isArray(rows) && rows.length > 1) {
          setReal(rows.map((r: { balance: number }, i: number) => ({ i, v: Number(r.balance) || 0 })));
        }
      })
      .catch(() => {
        /* no history available — fall back to sample */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const isSample = !real;
  const data = useMemo(() => real ?? sampleSeries(currentValue), [real, currentValue]);
  const stroke = positive ? "#10b981" : "#ef4444";

  return (
    <div className="relative flex-1 min-h-[120px] -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="pv-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={2}
            fill="url(#pv-spark)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {isSample && (
        <span className="absolute bottom-1 right-2 text-[10px] text-muted-foreground/60">
          sample
        </span>
      )}
    </div>
  );
};

export default PortfolioValueSparkline;

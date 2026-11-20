import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { RewardsConverterInfo, RewardsConverterVolumeBucket } from "@strato/shared-types";
import { useRewardsConverterDailyVolume, useRewardsConverterMonthlyVolume } from "@/hooks/useRewardsConverter";
import { formatUnits } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatTokenAmount } from "./formatTokenAmount";

type View = "daily" | "monthly";

const VIEWS: { view: View; label: string }[] = [
  { view: "daily", label: "Daily" },
  { view: "monthly", label: "Monthly" },
];

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

const shiftMonth = (month: string, by: number): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + by, 1)).toISOString().slice(0, 7);
};

const formatMonth = (month: string): string =>
  new Date(`${month}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const ConversionVolume = ({ state }: { state: RewardsConverterInfo }) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("daily");
  const [month, setMonth] = useState(currentMonth);
  const daily = useRewardsConverterDailyVolume(month, open && view === "daily");
  const monthly = useRewardsConverterMonthlyVolume(open && view === "monthly");
  const { data = [], isLoading } = view === "daily" ? daily : monthly;
  const { rewardsToken, stratoToken } = state;
  const series = data.map((bucket) => ({ ...bucket, value: Number(formatUnits(bucket.paid, stratoToken.decimals)) }));

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="border border-border/70">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 p-6 text-left">
          <span className="flex flex-col space-y-1.5">
            <span className="text-lg font-semibold leading-none tracking-tight">Conversion volume</span>
            <span className="text-sm text-muted-foreground">
              {stratoToken.symbol} paid per UTC day or month.
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {VIEWS.map((option) => (
                  <Button
                    key={option.view}
                    size="sm"
                    variant={view === option.view ? "default" : "outline"}
                    onClick={() => setView(option.view)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {view === "daily" && (
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Previous month"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-32 text-center text-sm font-medium">{formatMonth(month)}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Next month"
                    disabled={month >= currentMonth()}
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="h-[220px] w-full">
              {series.length > 0 ? (
                <ChartContainer config={{ value: { color: "hsl(var(--primary))" } }} className="h-full w-full">
                  <BarChart data={series} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="period"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(period: string) => (view === "daily" ? period.slice(-2) : period)}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={72}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(value) => Intl.NumberFormat("en-US", { notation: "compact" }).format(Number(value))}
                    />
                    <ChartTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const bucket = payload[0].payload as RewardsConverterVolumeBucket;
                        return (
                          <div className="rounded-lg border border-border bg-popover p-3 text-sm shadow-lg">
                            <p className="text-xs text-muted-foreground">{bucket.period}</p>
                            <p className="mt-1 font-semibold text-popover-foreground">
                              {formatTokenAmount(bucket.paid, stratoToken)} paid
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatTokenAmount(bucket.burned, rewardsToken)} burned
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {bucket.count} {bucket.count === 1 ? "conversion" : "conversions"}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-md bg-muted/30 text-sm text-muted-foreground">
                  {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : "No conversions yet"}
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default ConversionVolume;

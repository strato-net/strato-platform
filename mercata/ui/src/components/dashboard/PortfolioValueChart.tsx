import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

type PortfolioDataPoint = {
  timestamp: number;
  balance: number | string;
};

type TabType = 'netBalance' | 'rewards' | 'borrowed' | 'earnings' | 'estAnnual';
interface PortfolioValueChartProps {
  data: PortfolioDataPoint[];
  onTimeRangeChange?: (duration: string) => void;
  selectedTimeRange?: string;
  isLoading?: boolean;
  tabType?: TabType;
  title?: string;
  subtitle?: string;
  currentValue?: number;
  /** When true, time range UI is rendered outside (e.g. Performance toolbar). */
  hideTimeRangeSelector?: boolean;
  /** When false, omits horizontal reference line (e.g. header KPI unit ≠ series unit). */
  showReferenceLine?: boolean;
}

/** Shared with Performance toolbar — keep labels in sync with chart fetch ranges. */
export const PORTFOLIO_CHART_TIME_RANGE_OPTIONS = [
  { label: "1 Day", value: "1d" },
  { label: "1 Week", value: "7d" },
  { label: "1 Month", value: "1m" },
  { label: "3 Months", value: "3m" },
  { label: "6 Months", value: "6m" },
  { label: "1 Year", value: "1y" },
  { label: "All Time", value: "all" },
] as const;

// Convert timestamp to date or time string for display based on range
const formatDate = (timestamp: number, isTimeRange: boolean): string => {
  if (isTimeRange) {
    return format(new Date(timestamp), 'h:mm a');
  }
  return format(new Date(timestamp), 'MMM d');
};

// Format timestamp to full date for tooltip
const formatFullDate = (timestamp: number): string => {
  return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
};

// Calculate time range in hours
const calculateTimeRangeHours = (data: PortfolioDataPoint[]): number => {
  if (data.length < 2) return 0;
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
  const first = sorted[0].timestamp;
  const last = sorted[sorted.length - 1].timestamp;
  return (last - first) / (1000 * 60 * 60); // Convert milliseconds to hours
};

// Calculate percentage change
const calculateChange = (data: PortfolioDataPoint[]): { percentage: number | null; amount: number; isPositive: boolean } => {
  if (data.length < 2) return { percentage: null, amount: 0, isPositive: true };

  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
  const firstRaw = sorted[0].balance;
  const lastRaw = sorted[sorted.length - 1].balance;
  const first = typeof firstRaw === "string" ? parseFloat(firstRaw) : firstRaw;
  const last = typeof lastRaw === "string" ? parseFloat(lastRaw) : lastRaw;
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return { percentage: null, amount: 0, isPositive: true };
  }
  const changeAmount = last - first;
  
  return {
    percentage: first === 0 ? null : Math.abs((changeAmount / first) * 100),
    amount: Math.abs(changeAmount),
    isPositive: changeAmount >= 0
  };
};

const getChangeText = (hasData: boolean, tabType: TabType, change: { percentage: number | null; amount: number; isPositive: boolean }): string => {
  if (!hasData) return '—';
  let txt: string = '';
  const twoDigits = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const amt: string = change.amount.toLocaleString('en-US', twoDigits);
  const pct: string = change.percentage?.toLocaleString('en-US', twoDigits);
  switch (tabType) {
    case 'rewards':
      txt = `${amt} Reward Points`; break;
    case 'borrowed':
      txt = `${amt} USDST`; break;
    case 'estAnnual':
    case 'earnings':
    case 'netBalance':
      txt = `$${amt}`; break;
    default:
      txt = `${amt}`; break;
  }
  if (change.percentage !== null) txt += ` (${pct}%)`;
  return txt;
};

const PortfolioValueChart: React.FC<PortfolioValueChartProps> = ({ 
  data, 
  onTimeRangeChange,
  selectedTimeRange = '7d',
  isLoading = false,
  tabType = 'netBalance',
  title = 'Portfolio Value',
  subtitle = 'Net balance over time',
  currentValue: propCurrentValue,
  hideTimeRangeSelector = false,
  showReferenceLine = true,
}) => {
  // Determine color scheme based on tab type
  const getColorScheme = (tab: TabType): { line: string; positive: string; negative: string } => {
    switch (tab) {
      case 'rewards':
        return { line: '#a855f7', positive: '#a855f7', negative: '#ef4444' }; // purple-500
      case 'borrowed':
        return { line: '#f97316', positive: '#f97316', negative: '#f97316' }; // orange-500
      case 'earnings':
      case 'estAnnual':
        return { line: '#10b981', positive: '#10b981', negative: '#ef4444' }; // emerald-500
      default:
        return { line: '#3b82f6', positive: '#22c55e', negative: '#ef4444' }; // blue-500
    }
  };

  const colors = getColorScheme(tabType);
  // Memoize chart data transformations to prevent unnecessary recalculations
  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return [];
    }

    const timeRangeHours = calculateTimeRangeHours(data);
    const isTimeRange = timeRangeHours <= 24;

    return [...data]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(point => {
        const balance = typeof point.balance === 'string' 
          ? parseFloat(point.balance) 
          : point.balance;
        // Normalize value for netBalance tab, keep raw for others
        const value = balance;
        return {
          timestamp: point.timestamp,
          date: formatDate(point.timestamp, isTimeRange),
          value,
          raw: balance
        };
      })
      .filter(point => !isNaN(point.value) && point.value >= 0);
  }, [data]);

  const hasData = chartData.length > 0;

  // Memoize calculated values
  const { currentValue, change, yAxisDomain, scale } = useMemo(() => {
    if (!hasData) {
      return { 
        currentValue: propCurrentValue || 0, 
        change: { percentage: 0, amount: 0, isPositive: true }, 
        yAxisDomain: [0, 100],
        scale: { divisor: 1, suffix: '' }
      };
    }

    const currentValue = propCurrentValue !== undefined ? propCurrentValue : (chartData[chartData.length - 1]?.value || 0);
    const change = calculateChange(data);
    
    const values = chartData.map(d => d.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const padding = range > 0 ? range * 0.1 : maxValue * 0.05;

    let yMin = Math.max(0, minValue - padding);
    let yMax = maxValue + padding;
    // Recharts / linear scales divide by (max − min). All-zero or flat series ⇒ [0,0] ⇒ RangeError in prod builds.
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
      const base = Number.isFinite(yMin) && yMin >= 0 ? yMin : 0;
      yMin = base;
      yMax = base + (base > 0 ? Math.max(base * 1e-6, 1e-9) : 1);
    }

    const yAxisDomain: [number, number] = [yMin, yMax];

    const maxDomainValue = yMax;
    let scale;
    if (maxDomainValue >= 1000000) {
      scale = { divisor: 1000000, suffix: 'M' };
    } else if (maxDomainValue >= 1000) {
      scale = { divisor: 1000, suffix: 'k' };
    } else {
      scale = { divisor: 1, suffix: '' };
    }

    return { currentValue, change, yAxisDomain, scale };
  }, [chartData, data, hasData, propCurrentValue]);

  // Determine color based on trend and tab type
  const lineColor = change.isPositive ? colors.positive : colors.negative;

  const fmt2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
  const primaryValueClass =
    "text-lg font-bold tabular-nums leading-tight break-words md:text-2xl";

  return (
    <Card className="mb-6">
      <CardHeader className="space-y-0 pb-3 pt-4 px-4 md:pb-6 md:pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-lg font-bold md:text-2xl">{title}</h3>
            <p className="text-xs text-muted-foreground md:text-sm">{subtitle}</p>
          </div>
          <div className="min-w-0 w-full space-y-1 md:w-auto md:max-w-[min(100%,22rem)] md:text-right">
            {tabType === "rewards" ? (
              <>
                <div className={cn(primaryValueClass, "md:text-right")}>
                  {currentValue.toLocaleString("en-US", fmt2)}
                </div>
                <div className="text-xs text-muted-foreground md:text-sm md:text-right">Claimed reward points</div>
              </>
            ) : tabType === "estAnnual" ? (
              <>
                <div className={cn(primaryValueClass, "md:text-right")}>
                  ${currentValue.toLocaleString("en-US", fmt2)}
                  <span className="text-sm font-semibold text-muted-foreground md:text-base"> / yr</span>
                </div>
              </>
            ) : tabType === "earnings" ? (
              <>
                <div className={cn(primaryValueClass, "md:text-right")}>
                  ${currentValue.toLocaleString("en-US", fmt2)}
                </div>
                <div className="text-xs text-muted-foreground md:text-sm md:text-right">In earning positions</div>
              </>
            ) : tabType === "borrowed" ? (
              <>
                <div className={cn(primaryValueClass, "md:text-right")}>
                  {currentValue.toLocaleString("en-US", fmt2)}
                </div>
                <div className="text-xs text-muted-foreground md:text-sm md:text-right">USDST</div>
              </>
            ) : (
              <div className={cn(primaryValueClass, "md:text-right")}>
                ${currentValue.toLocaleString("en-US", fmt2)}
              </div>
            )}
            <div
              className={cn(
                "flex flex-wrap items-center gap-1 text-xs md:text-sm md:justify-end",
                tabType === "rewards"
                  ? "text-purple-500"
                  : tabType === "borrowed"
                    ? "text-orange-500"
                    : tabType === "earnings" || tabType === "estAnnual"
                      ? "text-emerald-600"
                      : change.isPositive
                        ? "text-green-500"
                        : "text-red-500"
              )}
            >
              {change.isPositive ? (
                <TrendingUp size={16} color={getColorScheme(tabType).positive} className="shrink-0" />
              ) : (
                <TrendingDown size={16} color={getColorScheme(tabType).negative} className="shrink-0" />
              )}
              <span className="min-w-0 text-left md:text-right">{getChangeText(hasData, tabType, change)}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-hidden px-3 pb-4 pt-0 sm:px-6 sm:pb-6">
        <div className="relative w-full h-64 sm:h-72 md:h-80">
          {hasData ? (
            <>
              <ChartContainer
            config={{
              value: {
                theme: {
                  light: colors.line,
                  dark: colors.line,
                }
              },
            }}
                className="w-full h-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid 
                      strokeDasharray="3 3" 
                      vertical={false}
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      domain={yAxisDomain}
                      width={80}
                      tickFormatter={(value) => {
                        const scaledValue = value / scale.divisor;
                        const formatted = scaledValue >= 1 ? scaledValue.toFixed(1) : scaledValue.toFixed(2);
                        
                        if (tabType === 'rewards') {
                          return `Points ${formatted}${scale.suffix}`;
                        } else if (tabType === 'borrowed') {
                          return `USDST ${formatted}${scale.suffix}`;
                        } else {
                          return `$${formatted}${scale.suffix}`;
                        }
                      }}
                    />
                    <ChartTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        
                        const dataPoint = payload[0].payload as typeof chartData[0];
                        return (
                          <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
                            <p className="text-xs text-muted-foreground mb-1">
                              {formatFullDate(dataPoint.timestamp)}
                            </p>
                            <p className="text-sm font-semibold text-popover-foreground">
                              {tabType === 'rewards' ? (
                                `${dataPoint.value.toLocaleString('en-US', { 
                                  minimumFractionDigits: 2, 
                                  maximumFractionDigits: 2 
                                })} Reward Points`
                              ) : tabType === 'borrowed' ? (
                                `${dataPoint.value.toLocaleString('en-US', { 
                                  minimumFractionDigits: 2, 
                                  maximumFractionDigits: 2 
                                })} USDST`
                              ) : tabType === 'earnings' || tabType === 'estAnnual' ? (
                                `$${dataPoint.value.toLocaleString('en-US', { 
                                  minimumFractionDigits: 2, 
                                  maximumFractionDigits: 2 
                                })} (est.)`
                              ) : (
                                `$${dataPoint.value.toLocaleString('en-US', { 
                                  minimumFractionDigits: 2, 
                                  maximumFractionDigits: 2 
                                })}`
                              )}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={lineColor}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 6, fill: lineColor }}
                      animationDuration={350}
                      animationEasing="ease-out"
                    />
                    {showReferenceLine && (
                    <ReferenceLine 
                      y={currentValue} 
                      stroke={lineColor}
                      strokeDasharray="2 2"
                      strokeOpacity={0.3}
                    />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="animate-spin" size={18} />
                    <span>Updating chart...</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground bg-muted/50 rounded-md">
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={18} />
                  <span>Loading chart data...</span>
                </div>
              ) : (
                <span>No portfolio data available</span>
              )}
            </div>
          )}
        </div>
        
        {onTimeRangeChange && !hideTimeRangeSelector && (
          <div
            className={cn(
              "mt-3 gap-2 border-t border-border pt-3 sm:mt-4 sm:pt-4",
              "grid grid-cols-3",
              "md:flex md:flex-wrap md:items-center md:justify-center md:gap-2"
            )}
          >
            {PORTFOLIO_CHART_TIME_RANGE_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => onTimeRangeChange(value)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors sm:px-2.5 sm:text-sm",
                  value === "all" && "col-span-3 md:col-auto md:w-auto",
                  selectedTimeRange === value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PortfolioValueChart;


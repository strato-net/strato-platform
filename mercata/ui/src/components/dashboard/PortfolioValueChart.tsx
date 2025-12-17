import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
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
  balance: number;
};

type TabType = 'netBalance' | 'rewards' | 'borrowed';

interface PortfolioValueChartProps {
  data: PortfolioDataPoint[];
  onTimeRangeChange?: (duration: string) => void;
  selectedTimeRange?: string;
  isLoading?: boolean;
  tabType?: TabType;
  title?: string;
  subtitle?: string;
  currentValue?: number;
}

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
const calculateChange = (data: PortfolioDataPoint[]): { value: number; isPositive: boolean } => {
  if (data.length < 2) return { value: 0, isPositive: true };
  
  const first = data[0].balance;
  const last = data[data.length - 1].balance;
  if (first === 0) return { value: 0, isPositive: true };
  const change = ((last - first) / first) * 100;
  
  return {
    value: Math.abs(change),
    isPositive: change >= 0
  };
};

const PortfolioValueChart: React.FC<PortfolioValueChartProps> = ({ 
  data, 
  onTimeRangeChange,
  selectedTimeRange = '7d',
  isLoading = false,
  tabType = 'netBalance',
  title = 'Portfolio Value',
  subtitle = 'Net balance over time',
  currentValue: propCurrentValue
}) => {
  // Determine color scheme based on tab type
  const getColorScheme = (tab: TabType): { line: string; positive: string; negative: string } => {
    switch (tab) {
      case 'rewards':
        return { line: '#a855f7', positive: '#a855f7', negative: '#ef4444' }; // purple-500
      case 'borrowed':
        return { line: '#f97316', positive: '#f97316', negative: '#f97316' }; // orange-500
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
        change: { value: 0, isPositive: true }, 
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
    
    const yAxisDomain = [
      Math.max(0, minValue - padding),
      maxValue + padding
    ];

    const maxDomainValue = maxValue + padding;
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

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {tabType === 'rewards' ? (
                `${currentValue.toLocaleString('en-US', { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })} Claimed Reward Points`
              ) : tabType === 'borrowed' ? (
                `${currentValue.toLocaleString('en-US', { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })} USDST`
              ) : (
                `$${currentValue.toLocaleString('en-US', { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })}`
              )}
            </div>
            <div className={`flex items-center gap-1 text-sm ${tabType === 'rewards' ? 'text-purple-500' : tabType === 'borrowed' ? 'text-orange-500' : change.isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {change.isPositive ? <TrendingUp size={16} color={getColorScheme(tabType).positive} /> : <TrendingDown size={16} color={getColorScheme(tabType).negative}/>}
              <span>{hasData ? `${change.value.toFixed(2)}%` : '—'}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-hidden">
        <div className="relative w-full h-80">
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
                    <ReferenceLine 
                      y={currentValue} 
                      stroke={lineColor}
                      strokeDasharray="2 2"
                      strokeOpacity={0.3}
                    />
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
        
        {/* Time Range Selector */}
        {onTimeRangeChange && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 pt-4 border-t border-border">
            {[
              { label: '1 Day', value: '1d' },
              { label: '1 Week', value: '7d' },
              { label: '1 Month', value: '1m' },
              { label: '3 Months', value: '3m' },
              { label: '6 Months', value: '6m' },
              { label: '1 Year', value: '1y' },
              { label: 'All Time', value: 'all' }
            ].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => onTimeRangeChange(value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  selectedTimeRange === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
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


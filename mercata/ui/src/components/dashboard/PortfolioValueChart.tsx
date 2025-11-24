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
import { TrendingUp, TrendingDown } from 'lucide-react';

type PortfolioDataPoint = {
  timestamp: number;
  netBalance: number;
};

interface PortfolioValueChartProps {
  data: PortfolioDataPoint[];
  onTimeRangeChange?: (duration: string) => void;
  selectedTimeRange?: string;
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

// Format balance value
const formatBalance = (value: number): string => {
  // Convert from wei-like units (e22) to readable format
  const dollars = value / 1e22;
  if (dollars >= 1000) {
    return `$${(dollars / 1000).toFixed(1)}k`;
  }
  return `$${dollars.toFixed(2)}`;
};

// Calculate percentage change
const calculateChange = (data: PortfolioDataPoint[]): { value: number; isPositive: boolean } => {
  if (data.length < 2) return { value: 0, isPositive: true };
  
  const first = data[0].netBalance / 1e22;
  const last = data[data.length - 1].netBalance / 1e22;
  const change = ((last - first) / first) * 100;
  
  return {
    value: Math.abs(change),
    isPositive: change >= 0
  };
};

const PortfolioValueChart: React.FC<PortfolioValueChartProps> = ({ 
  data, 
  onTimeRangeChange,
  selectedTimeRange = '7d'
}) => {
  if (data.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center justify-center h-80">
          <p className="text-gray-500">No portfolio data available</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate time range to determine formatting
  const timeRangeHours = calculateTimeRangeHours(data);
  const isTimeRange = timeRangeHours <= 24;

  // Transform data for chart (normalize to display values)
  // Handle both string and number netBalance values
  const chartData = data
    .sort((a, b) => a.timestamp - b.timestamp) // Ensure chronological order
    .map(point => {
      const netBalance = typeof point.netBalance === 'string' 
        ? parseFloat(point.netBalance) 
        : point.netBalance;
      return {
        timestamp: point.timestamp,
        date: formatDate(point.timestamp, isTimeRange),
        value: netBalance, // Convert to readable format
        raw: netBalance
      };
    })
    .filter(point => !isNaN(point.value) && point.value >= 0); // Filter invalid data points

  // Check if we have valid data after filtering
  if (chartData.length === 0) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center justify-center h-80">
          <p className="text-gray-500">No valid portfolio data available</p>
        </CardContent>
      </Card>
    );
  }

  const currentValue = chartData[chartData.length - 1]?.value || 0;
  const change = calculateChange(data);
  
  // Calculate domain with padding
  const values = chartData.map(d => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const padding = range > 0 ? range * 0.1 : maxValue * 0.05; // Fallback if all values are the same
  
  const yAxisDomain = [
    Math.max(0, minValue - padding),
    maxValue + padding
  ];

  // Determine color based on trend - stock chart style (green for gains, red for losses)
  const lineColor = change.isPositive ? '#10b981' : '#ef4444'; // green-500 or red-500

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold">Portfolio Value</h3>
            <p className="text-sm text-gray-600 mt-1">Net balance over time</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              ${currentValue.toLocaleString('en-US', { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 2 
              })}
            </div>
            <div className={`flex items-center gap-1 text-sm ${change.isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {change.isPositive ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
              <span>{change.value.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-hidden">
        <div className="w-full h-80">
          <ChartContainer
            config={{
              value: {
                theme: {
                  light: lineColor,
                  dark: lineColor,
                }
              },
            }}
            className="w-full h-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid 
                  strokeDasharray="3 3" 
                  vertical={false}
                  stroke="#e5e7eb"
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
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  domain={yAxisDomain}
                  width={60}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                />
                <ChartTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    
                    const data = payload[0].payload as typeof chartData[0];
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                        <p className="text-xs text-gray-500 mb-1">
                          {formatFullDate(data.timestamp)}
                        </p>
                        <p className="text-sm font-semibold">
                          ${data.value.toLocaleString('en-US', { 
                            minimumFractionDigits: 2, 
                            maximumFractionDigits: 2 
                          })}
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
        </div>
        
        {/* Time Range Selector */}
        {onTimeRangeChange && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-200">
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
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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


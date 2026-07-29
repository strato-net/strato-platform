import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

// Types
type ChartDataPoint = {
  date: string;
  price: string;
  timestamp?: number;
};

interface PriceChartProps {
  data: ChartDataPoint[];
  loading: boolean;
  title: string;
  subtitle?: string;
  loadingMessage?: string;
  emptyMessage?: string;
  chartColor: string;
  gradientId: string;
}

// Utilities
const calculateYAxisDomain = (prices: number[], paddingPercent: number = 0.15): number[] => {
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;
  // Handle edge case where all prices are the same
  const padding = priceRange > 0 ? priceRange * paddingPercent : maxPrice * 0.1;
  return [
    Math.max(0, minPrice - padding), // Don't go below 0
    maxPrice + padding
  ];
};

const formatTooltipValue = (value: string | number): string => {
  return `${parseFloat(value.toString()).toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 18 
  })} USDST`;
};

const renderLoadingState = (message: string) => (
  <div className="flex items-center justify-center h-80 bg-muted/50 rounded-md">
    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
    <p className="text-muted-foreground ml-3">{message}</p>
  </div>
);

const renderEmptyState = (message: string) => (
  <div className="flex items-center justify-center h-80 bg-muted/50 rounded-md">
    <p className="text-muted-foreground">{message}</p>
  </div>
);

const PriceChart: React.FC<PriceChartProps> = ({
  data,
  loading,
  title,
  subtitle,
  loadingMessage = "Loading chart data...",
  emptyMessage = "No data available",
  chartColor,
  gradientId
}) => {
  const renderChart = () => {
    if (loading) {
      return renderLoadingState(loadingMessage);
    }

    if (data.length === 0) {
      return renderEmptyState(emptyMessage);
    }

    const prices = data.map(point => parseFloat(point.price));
    const yAxisDomain = calculateYAxisDomain(prices);

    return (
      <div className="w-full aspect-[21/9]">
        <ChartContainer
          config={{
            price: {
              theme: {
                light: chartColor,
                dark: chartColor,
              }
            },
            tooltip: {
              theme: {
                light: "gray",
                dark: "gray"
              }
            }
          }}
          className="w-full h-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10 }}
                tickCount={8}
                tickFormatter={(value) => {
                  const parts = value.split(' ');
                  return parts[0];
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
                domain={yAxisDomain}
                width={50}
                tickFormatter={(value) => `$${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              />
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <ChartTooltip
                content={<ChartTooltipContent 
                  labelFormatter={(value) => `${value}`}
                  formatter={(value: string | number) => [formatTooltipValue(value)]}
                />}
              />
              <Area
                type="monotone"
                dataKey="price"
                name="Price"
                stroke={chartColor}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
                activeDot={{ r: 8 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    );
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="overflow-hidden">
        {renderChart()}
      </CardContent>
    </Card>
  );
};

export default PriceChart; 
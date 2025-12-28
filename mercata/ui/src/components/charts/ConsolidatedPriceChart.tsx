import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

// Types
type SpotPricePoint = {
  date: string;
  price: string;
  timestamp?: number;
};

type SwapPricePoint = {
  date: string;
  price: string;
  timestamp: number;
  poolAddress?: string;
  volume?: string;
};

interface ConsolidatedPriceChartProps {
  spotData: SpotPricePoint[];
  swapData: SwapPricePoint[];
  spotLoading: boolean;
  swapLoading: boolean;
  title: string;
  subtitle?: string;
}

// Color scheme
const CHART_COLORS = {
  SPOT: "#2563eb",      // Blue - Oracle/Spot price (reference)
  SWAP: "#f97316",      // Orange - Swap pool price (actual trading)
};

// Utilities
const calculateYAxisDomain = (prices: number[], paddingPercent: number = 0.15): number[] => {
  if (prices.length === 0) return [0, 100];
  
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
  return `$${parseFloat(value.toString()).toLocaleString('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 6 
  })}`;
};

const renderLoadingState = (message: string) => (
  <div className="flex items-center justify-center h-96 bg-muted/50 rounded-md">
    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
    <p className="text-muted-foreground ml-3">{message}</p>
  </div>
);

const renderEmptyState = (message: string) => (
  <div className="flex items-center justify-center h-96 bg-muted/50 rounded-md">
    <p className="text-muted-foreground">{message}</p>
  </div>
);

// Merge and align data points by timestamp
const mergeDataByTimestamp = (spotData: SpotPricePoint[], swapData: SwapPricePoint[]) => {
  const dataMap = new Map<string, { date: string; spotPrice?: number; swapPrice?: number; timestamp: number }>();
  
  // Add spot prices
  spotData.forEach(point => {
    const timestamp = point.timestamp || 0;
    dataMap.set(point.date, {
      date: point.date,
      spotPrice: parseFloat(point.price),
      timestamp
    });
  });
  
  // Add swap prices
  swapData.forEach(point => {
    const existing = dataMap.get(point.date);
    if (existing) {
      existing.swapPrice = parseFloat(point.price);
    } else {
      dataMap.set(point.date, {
        date: point.date,
        swapPrice: parseFloat(point.price),
        timestamp: point.timestamp
      });
    }
  });
  
  // Convert to array and sort by timestamp
  return Array.from(dataMap.values())
    .sort((a, b) => a.timestamp - b.timestamp);
};

const ConsolidatedPriceChart: React.FC<ConsolidatedPriceChartProps> = ({
  spotData,
  swapData,
  spotLoading,
  swapLoading,
  title,
  subtitle,
}) => {
  const renderChart = () => {
    const loading = spotLoading || swapLoading;
    
    if (loading) {
      return renderLoadingState("Loading price history...");
    }

    const hasSpotData = spotData.length > 0;
    const hasSwapData = swapData.length > 0;

    if (!hasSpotData && !hasSwapData) {
      return renderEmptyState("No price history available for this asset");
    }

    // Merge data by timestamp/date
    const mergedData = mergeDataByTimestamp(spotData, swapData);
    
    // Calculate y-axis domain from all prices
    const allPrices = [
      ...spotData.map(p => parseFloat(p.price)),
      ...swapData.map(p => parseFloat(p.price))
    ];
    const yAxisDomain = calculateYAxisDomain(allPrices);

    return (
      <div className="w-full aspect-[21/9]">
        <ChartContainer
          config={{
            spotPrice: {
              label: "Spot Price (Oracle)",
              theme: {
                light: CHART_COLORS.SPOT,
                dark: CHART_COLORS.SPOT,
              }
            },
            swapPrice: {
              label: "Swap Pool Price",
              theme: {
                light: CHART_COLORS.SWAP,
                dark: CHART_COLORS.SWAP,
              }
            },
          }}
          className="w-full h-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={mergedData}
              margin={{ top: 10, right: 30, left: 30, bottom: 5 }}
            >
              <defs>
                <linearGradient id="colorSpot" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.SPOT} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.SPOT} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorSwap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.SWAP} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={CHART_COLORS.SWAP} stopOpacity={0} />
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
                width={80}
                tickFormatter={(value) => `$${parseFloat(value).toLocaleString('en-US', { 
                  minimumFractionDigits: 2, 
                  maximumFractionDigits: 2 
                })}`}
              />
              
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              
              <Legend 
                verticalAlign="top" 
                height={40}
                iconType="line"
                wrapperStyle={{ paddingBottom: '10px' }}
                formatter={(value) => {
                  if (value === 'spotPrice') return 'Spot Price (Oracle)';
                  if (value === 'swapPrice') return 'Swap Pool Price (Trading)';
                  return value;
                }}
              />
              
              <ChartTooltip
                content={<ChartTooltipContent 
                  labelFormatter={(value) => `${value}`}
                  formatter={(value: string | number, name: string) => {
                    if (value === undefined || value === null) return null;
                    const label = name === 'spotPrice' ? 'Spot Price' : 'Swap Pool Price';
                    return [formatTooltipValue(value), label];
                  }}
                />}
              />
              
              {/* Spot Price - Solid line with subtle gradient */}
              {hasSpotData && (
                <Area
                  type="monotone"
                  dataKey="spotPrice"
                  name="spotPrice"
                  stroke={CHART_COLORS.SPOT}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorSpot)"
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              )}
              
              {/* Swap Pool Price - Dashed line with lighter gradient */}
              {hasSwapData && (
                <Area
                  type="monotone"
                  dataKey="swapPrice"
                  name="swapPrice"
                  stroke={CHART_COLORS.SWAP}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fillOpacity={1}
                  fill="url(#colorSwap)"
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              )}
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

export default ConsolidatedPriceChart;


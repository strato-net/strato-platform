import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip,
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
  isLPToken?: boolean;
}

// Color scheme
const CHART_COLORS = {
  SPOT: "#2563eb",      // Blue - Spot price
  SWAP: "#f97316",      // Orange - STRATO price
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
    maximumFractionDigits: 2 
  })}`;
};

// Custom tooltip component
const CustomTooltip = ({
  active,
  payload,
  label,
  isLPToken
}: {
  active?: boolean;
  payload?: Array<Record<string, unknown>>;
  label?: string;
  isLPToken?: boolean;
}) => {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  // Always get both values from the underlying data point
  const dataPoint = (payload[0] && 'payload' in payload[0] ? payload[0].payload : {}) as Record<string, unknown>;
  const stratoPrice = dataPoint.swapPrice as number | undefined;
  const spotPrice = dataPoint.spotPrice as number | undefined;

  // For LP tokens, only show NAV (spotPrice), not STRATO price
  if (isLPToken) {
    return (
      <div className="rounded-lg border bg-background p-2 md:p-3 shadow-lg text-xs md:text-sm">
        <p className="font-medium mb-2 text-xs md:text-sm">{label}</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS.SPOT }} />
            <span className="text-xs md:text-sm">
              Net Asset Value: {spotPrice !== undefined && spotPrice !== null ? formatTooltipValue(spotPrice) : 'N/A'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // For regular tokens, show both prices
  return (
    <div className="rounded-lg border bg-background p-2 md:p-3 shadow-lg text-xs md:text-sm">
      <p className="font-medium mb-2 text-xs md:text-sm">{label}</p>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS.SWAP }} />
          <span className="text-xs md:text-sm">
            STRATO Price: {stratoPrice !== undefined && stratoPrice !== null ? formatTooltipValue(stratoPrice) : 'N/A'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS.SPOT }} />
          <span className="text-xs md:text-sm">
            Spot Price: {spotPrice !== undefined && spotPrice !== null ? formatTooltipValue(spotPrice) : 'N/A'}
          </span>
        </div>
      </div>
    </div>
  );
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
  isLPToken = false,
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

    // Merge data by timestamp/date and forward-fill missing values
    let mergedData = mergeDataByTimestamp(spotData, swapData);
    
    // Forward-fill missing values to avoid N/A in tooltips
    let lastSpotPrice: number | undefined;
    let lastSwapPrice: number | undefined;
    
    mergedData = mergedData.map(point => {
      if (point.spotPrice !== undefined) lastSpotPrice = point.spotPrice;
      if (point.swapPrice !== undefined) lastSwapPrice = point.swapPrice;
      
      return {
        ...point,
        spotPrice: point.spotPrice ?? lastSpotPrice,
        swapPrice: point.swapPrice ?? lastSwapPrice
      };
    });
    
    // Calculate y-axis domain from all prices
    const allPrices = [
      ...spotData.map(p => parseFloat(p.price)),
      ...swapData.map(p => parseFloat(p.price))
    ];
    const yAxisDomain = calculateYAxisDomain(allPrices);

    // Smart tick calculation based on data density
    // 1. Pick the dataset with more data points
    const primaryData = spotData.length > swapData.length ? spotData : swapData;
    
    // 2. Calculate time range in days
    const timestamps = primaryData.map(p => p.timestamp).filter(t => t !== undefined) as number[];
    if (timestamps.length === 0) {
      return renderEmptyState("No valid timestamp data available");
    }
    
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const daysOfData = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60 * 24));
    
    // 3. Calculate average data points per day
    const avgPointsPerDay = Math.max(1, Math.round(primaryData.length / daysOfData));
    
    // 4. Calculate total slices needed
    const totalSlices = Math.ceil(daysOfData * avgPointsPerDay);
    
    // 5. Calculate interval to sample merged data
    const tickInterval = Math.max(1, Math.floor(mergedData.length / Math.min(totalSlices, 12)));
    
    // 6. Generate custom ticks at regular intervals
    const customTicks = mergedData
      .filter((_, index) => index % tickInterval === 0)
      .map(d => d.date);
    
    // Add the last data point if not already included
    if (mergedData.length > 0 && customTicks[customTicks.length - 1] !== mergedData[mergedData.length - 1].date) {
      customTicks.push(mergedData[mergedData.length - 1].date);
    }

    return (
      <div className="w-full aspect-[4/3] md:aspect-[21/9]">
        <ChartContainer
          config={{
            spotPrice: {
              label: isLPToken ? "Net Asset Value" : "Spot Price",
              theme: {
                light: CHART_COLORS.SPOT,
                dark: CHART_COLORS.SPOT,
              }
            },
            swapPrice: {
              label: "STRATO Price",
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
              margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
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
                tick={{ fontSize: 10, dy: 15 }}
                ticks={customTicks}
                tickFormatter={(value) => {
                  const parts = value.split(' ');
                  return parts[0];
                }}
                className="text-xs md:text-sm"
              />
              
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, dx: -5 }}
                domain={yAxisDomain}
                width={60}
                className="text-xs md:text-sm"
                tickFormatter={(value) => {
                  const formatted = parseFloat(value).toLocaleString('en-US', { 
                    minimumFractionDigits: 2, 
                    maximumFractionDigits: 2 
                  });
                  // On mobile, show shorter format if needed
                  return `$${formatted.length > 8 ? parseFloat(value).toFixed(2) : formatted}`;
                }}
              />
              
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              
              <Legend 
                verticalAlign="top" 
                height={40}
                iconType="line"
                wrapperStyle={{ paddingBottom: '10px' }}
                formatter={(value) => {
                  if (value === 'spotPrice') return isLPToken ? 'Net Asset Value' : 'Spot Price';
                  if (value === 'swapPrice') return 'STRATO Price';
                  return value;
                }}
                className="text-xs md:text-sm"
                iconSize={12}
              />
              
              <Tooltip content={<CustomTooltip isLPToken={isLPToken} />} />
              
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
              
              {/* STRATO Price - Solid line with lighter gradient */}
              {hasSwapData && (
                <Area
                  type="monotone"
                  dataKey="swapPrice"
                  name="swapPrice"
                  stroke={CHART_COLORS.SWAP}
                  strokeWidth={2}
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
      <CardHeader className="pb-3">
        <CardTitle className="text-lg md:text-xl">{title}</CardTitle>
        {subtitle && (
          <p className="text-xs md:text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="overflow-hidden px-2 md:px-6 pb-4">
        {renderChart()}
      </CardContent>
    </Card>
  );
};

export default ConsolidatedPriceChart;


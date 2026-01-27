import React, { useMemo, useState, useCallback, useRef, memo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Bar,
  Cell,
  Line,
  LineChart,
  Area,
} from 'recharts';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export interface OHLCData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  spotPrice?: number; // Optional spot price for pools (tokenA price / tokenB price)
}

interface CandlestickChartProps {
  data: OHLCData[];
  loading?: boolean;
  height?: number;
  showVolume?: boolean;
  chartType?: 'line' | 'candlestick';
  onHoverDataChange?: (data: any) => void;
  timeRange?: string; // Time range like '1d', '7d', etc. to determine date format
  showSpotPrice?: boolean; // Whether to show spot price line (for pools)
  isDollarValued?: boolean; // Whether the chart should be shown in dollars
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({
  data,
  loading = false,
  height = 300,
  showVolume = true,
  chartType = 'line',
  onHoverDataChange,
  timeRange,
  showSpotPrice = false,
  isDollarValued = true,
}) => {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const hoverLabelRef = useRef<string | null>(null);
  const hoverPriceRef = useRef<number | null>(null);

  // Determine if we should show dates or times based on time range
  const showDates = useMemo(() => {
    if (!timeRange) {
      // If no timeRange provided, check the actual data span
      if (data.length >= 2) {
        const timeSpan = data[data.length - 1].timestamp - data[0].timestamp;
        return timeSpan > 24 * 60 * 60 * 1000; // > 1 day
      }
      return false;
    }
    // Check if timeRange is greater than 1 day
    return timeRange !== '1h' && timeRange !== '1d';
  }, [timeRange, data]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => {
      // For very short intervals (10s), show time with seconds
      const timeFormat = timeRange === '1h' ? 'HH:mm:ss' : (showDates ? 'MMM d' : 'HH:mm');
      return {
        ...d,
        date: showDates
          ? format(new Date(d.timestamp), 'MMM d')
          : (timeRange === '1h' ? format(new Date(d.timestamp), 'HH:mm:ss') : format(new Date(d.timestamp), 'HH:mm')),
        fullDate: format(new Date(d.timestamp), 'MMM d, HH:mm'),
      };
    });
  }, [data, showDates, timeRange]);

  // Calculate custom ticks for x-axis (3-4 labels). Use timestamps as tick values
  // so keys are unique; Recharts will use tickFormatter to show date strings.
  const xAxisTicks = useMemo(() => {
    if (chartData.length === 0) return [];

    const firstTs = chartData[0]?.timestamp;
    const lastTs = chartData[chartData.length - 1]?.timestamp;
    const diff = lastTs - firstTs;
    const ts1 = firstTs + (diff / 3);
    const ts2 = firstTs + (2 * diff / 3);
    return [firstTs, ts1, ts2, lastTs];
  }, [chartData]);

  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const allValues = chartData.flatMap((d) => {
      const vals = [d.high, d.low];
      if (showSpotPrice && d.spotPrice != null) vals.push(d.spotPrice);
      return vals;
    });
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    let padding = (max - min) * 0.1;
    if (padding === 0 && max > 0) padding = max * 0.01; // 1% when pool price is flat
    if (padding === 0) padding = 1; // fallback so current price line can render
    return [Math.max(0, min - padding), max + padding];
  }, [chartData, showSpotPrice]);

  const currentPrice = useMemo(() => {
    if (chartData.length === 0) return null;
    return chartData[chartData.length - 1]?.close ?? null;
  }, [chartData]);

  // Overall trend color (green/red) based on first vs latest close
  const trendColor = useMemo(() => {
    if (chartData.length < 2) return '#22c55e';
    const firstPrice = chartData[0].close;
    const latestPrice = chartData[chartData.length - 1].close;
    return latestPrice >= firstPrice ? '#22c55e' : '#ef4444';
  }, [chartData]);

  const trendBgClass = useMemo(() => {
    if (chartData.length < 2) return 'bg-green-600';
    const firstPrice = chartData[0].close;
    const latestPrice = chartData[chartData.length - 1].close;
    return latestPrice >= firstPrice ? 'bg-green-600' : 'bg-red-600';
  }, [chartData]);

  const volumeDomain = useMemo(() => {
    if (!showVolume || chartData.length === 0) return [0, 100];
    const volumes = chartData.map((d) => d.volume || 0);
    const max = Math.max(...volumes);
    return [0, max * 1.1];
  }, [chartData, showVolume]);

  // Calculate line color based on first vs latest price
  const lineColor = useMemo(() => {
    if (chartType !== 'line' || chartData.length === 0) return '#3b82f6'; // Default blue

    const firstPrice = chartData[0].close;
    const latestPrice = chartData[chartData.length - 1].close;

    // Otherwise, green if up, red if down
    return latestPrice > firstPrice ? '#22c55e' : '#ef4444';
  }, [chartData, chartType]);

  // Calculate lighter spot price color (lighter version of main line color)
  const spotPriceColor = useMemo(() => {
    if (chartType !== 'line' || chartData.length === 0) return '#60a5fa'; // Lighter blue
    
    const firstPrice = chartData[0].close;
    const latestPrice = chartData[chartData.length - 1].close;
    
    // Lighter green or red
    return latestPrice > firstPrice ? '#86efac' : '#fca5a5'; // Lighter versions of green/red
  }, [chartData, chartType]);

  const chartHeightPx = showVolume ? height * 0.7 : height;
  const chartMargin = useMemo(() => ({ top: 10, right: 40, left: 10, bottom: 5 }), []);

  const currentPriceYPx = useMemo(() => {
    if (currentPrice === null) return null;
    const [min, max] = yAxisDomain;
    const range = max - min;
    if (range <= 0) return null;
    const innerHeight = chartHeightPx - chartMargin.top - chartMargin.bottom - 32;
    // y = top + (max - value) / (max - min) * innerHeight
    return chartMargin.top + ((max - currentPrice) / range) * innerHeight;
  }, [currentPrice, yAxisDomain, chartHeightPx, chartMargin.top, chartMargin.bottom]);

  // Current spot price (last point) when showSpotPrice is true
  const currentSpotPrice = useMemo(() => {
    if (!showSpotPrice || chartData.length === 0) return null;
    const last = chartData[chartData.length - 1];
    const spot = last?.spotPrice;
    return typeof spot === 'number' && !Number.isNaN(spot) ? spot : null;
  }, [showSpotPrice, chartData]);

  const currentSpotPriceYPx = useMemo(() => {
    if (currentSpotPrice === null) return null;
    const [min, max] = yAxisDomain;
    const range = max - min;
    if (range <= 0) return null;
    const innerHeight = chartHeightPx - chartMargin.top - chartMargin.bottom - 32;
    return chartMargin.top + ((max - currentSpotPrice) / range) * innerHeight;
  }, [currentSpotPrice, yAxisDomain, chartHeightPx, chartMargin.top, chartMargin.bottom]);

  // Calculate position of the latest data point for the pulsating dot
  const latestPointPosition = useMemo(() => {
    if (chartData.length === 0 || !chartContainerRef.current) return null;
    const latest = chartData[chartData.length - 1];
    const [min, max] = yAxisDomain;
    let range = max - min;
    if (range <= 0) range = 0;
    const innerHeight = chartHeightPx - chartMargin.top - chartMargin.bottom - 32;
    const containerWidth = chartContainerRef.current.offsetWidth;
    const innerWidth = containerWidth - chartMargin.left - chartMargin.right;

    // Calculate Y position (same logic as currentPriceYPx)
    const yPx = chartMargin.top + ((max - latest.close) / range) * innerHeight;

    // Calculate X position - last point is at the right edge of the plot area
    // Recharts positions data points evenly, so the last point is at the right margin
    const xPx = chartMargin.left + innerWidth;

    return { x: xPx, y: yPx, price: latest.close };
  }, [chartData, chartContainerRef, yAxisDomain, chartHeightPx, chartMargin]);

  const yPxToValue = useCallback((yPx: number): number | null => {
    const [min, max] = yAxisDomain;
    const range = max - min;
    if (range <= 0) return null;
    const innerHeight = chartHeightPx - chartMargin.top - chartMargin.bottom - 32;
    if (innerHeight <= 0) return null;

    // activeCoordinate.y from Recharts is relative to the plot area (after margins)
    // So yPx is already 0 at top of plot area, innerHeight at bottom
    // Clamp within plot area
    const clampedY = Math.min(Math.max(yPx, 0), innerHeight);
    const t = clampedY / innerHeight; // 0 at top, 1 at bottom
    // value = max - t * (max - min)
    return max - t * range;
  }, [yAxisDomain, chartHeightPx, chartMargin.top, chartMargin.bottom]);

  // Memoize the chart components to prevent rerenders
  const chartComponents = useMemo(() => {
    return (
      <>
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" opacity={0.3} />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={chartData.length >= 2 ? [chartData[0].timestamp, chartData[chartData.length - 1].timestamp] : undefined}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          ticks={xAxisTicks}
          interval={0}
          tickFormatter={(ts) => format(new Date(ts), showDates ? 'MMM d' : timeRange === '1h' ? 'HH:mm:ss' : 'HH:mm')}
        />
        <YAxis
          domain={yAxisDomain}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          width={60}
          tickFormatter={(value) => {
            if (value >= 1000) return `${isDollarValued ? '$' : ''}${(value / 1000).toFixed(1)}k`;
            return `${isDollarValued ? '$' : ''}${value.toFixed(2)}`;
          }}
        />
        {chartType === 'candlestick' && (
          <>
            {/* Render candlesticks */}
            <Bar
              dataKey="close"
              fill="transparent"
              isAnimationActive={false}
              shape={(props: any) => {
                const { payload, x, y, width } = props;
                // y is the y position for close value
                // Calculate other positions using domain
                const [min, max] = yAxisDomain;
                const range = max - min;
                const chartHeight = height * (showVolume ? 0.7 : 1);

                // Calculate the chart's top position
                // y is the position of close, so we can work backwards
                const closeRatio = (max - payload.close) / range;
                // Estimate chart top - this is approximate
                const estimatedChartTop = y - (closeRatio * chartHeight);

                const valueToY = (value: number) => {
                  const ratio = (max - value) / range;
                  return estimatedChartTop + (ratio * chartHeight);
                };

                const highY = valueToY(payload.high);
                const lowY = valueToY(payload.low);
                const openY = valueToY(payload.open);
                const closeY = y; // Use the provided y position

                const isUp = payload.close >= payload.open;
                const color = isUp ? '#22c55e' : '#ef4444';

                const bodyTop = Math.min(openY, closeY);
                const bodyBottom = Math.max(openY, closeY);
                const bodyHeight = Math.max(1, bodyBottom - bodyTop);

                const candleWidth = Math.max(2, width * 0.6);
                const candleX = x + (width - candleWidth) / 2;
                const wickX = x + width / 2;

                return (
                  <g>
                    {/* Wick (high-low line) */}
                    <line
                      x1={wickX}
                      y1={highY}
                      x2={wickX}
                      y2={lowY}
                      stroke={color}
                      strokeWidth={1}
                    />
                    {/* Body (open-close rectangle) */}
                    <rect
                      x={candleX}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      stroke={color}
                      strokeWidth={1}
                    />
                  </g>
                );
              }}
            />
          </>
        )}
        {chartType === 'line' && (
          <>
            {/* Main price line */}
            <Line
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4 }}
            />
            {/* Spot price line (for pools) */}
            {showSpotPrice && (
              <Line
                type="monotone"
                dataKey="spotPrice"
                stroke={spotPriceColor}
                strokeWidth={1.5}
                strokeOpacity={0.6}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 3 }}
              />
            )}
          </>
        )}
      </>
    );
  }, [chartType, yAxisDomain, height, showVolume, lineColor, xAxisTicks, chartData, showDates, timeRange, showSpotPrice, spotPriceColor]);

  const handleMouseMove = useCallback((state: any) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const payload = state.activePayload[0].payload;
      // Call hover callback immediately for responsive updates
      if (onHoverDataChange) {
        onHoverDataChange(payload);
      }
      // Keep a label for the hover timestamp without extra state
      hoverLabelRef.current = payload?.fullDate || payload?.date || null;
      // Use the activeCoordinate from Recharts
      // activeCoordinate is relative to the SVG element (includes margins)
      // For x: includes left margin
      // For y: includes top margin
      if (state.activeCoordinate) {
        setHoverX(state.activeCoordinate.x);
        setHoverY(state.activeCoordinate.y);
        // Convert container-relative y to plot-relative y for value calculation
        const plotY = state.activeCoordinate.y - chartMargin.top;
        const yValue = yPxToValue(plotY);
        hoverPriceRef.current = yValue;
      }
    }
  }, [onHoverDataChange, yPxToValue, chartMargin.top]);

  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
    setHoverY(null);
    if (onHoverDataChange) {
      onHoverDataChange(null);
    }
    hoverLabelRef.current = null;
    hoverPriceRef.current = null;
  }, [onHoverDataChange]);

  // if (loading) {
  //   return (
  //     <Card className="w-full">
  //       <CardContent className="flex items-center justify-center" style={{ height }}>
  //         <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  //       </CardContent>
  //     </Card>
  //   );
  // }

  if (chartData.length === 0) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center text-muted-foreground" style={{ height }}>
          No data available
        </CardContent>
      </Card>
    );
  }

  // Create a simple line chart for price and overlay candlesticks manually
  // For now, we'll use a simplified approach with area/line charts
  // A full candlestick implementation would require a specialized library
  return (
    <div className="w-full">
      <div className="relative" ref={chartContainerRef}>
        {/* Current spot price dotted line + pill (when showSpotPrice) - render first so pool pill is on top */}
        {showSpotPrice && currentSpotPriceYPx !== null && currentSpotPrice !== null && (
          <>
            <div
              className="absolute pointer-events-none z-10"
              style={{
                left: 0,
                right: 0,
                top: `${currentSpotPriceYPx}px`,
                borderTop: `1px dotted ${spotPriceColor}`,
                opacity: 0.9,
              }}
            />
            <div
              className="absolute pointer-events-none text-[10px] font-semibold px-1.5 py-0.5 rounded z-10 border border-white/30"
              style={{
                left: `${chartMargin.left}px`,
                top: `${currentSpotPriceYPx}px`,
                transform: 'translateY(-50%)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                backgroundColor: spotPriceColor,
                color: chartData.length >= 2 && chartData[chartData.length - 1].close > chartData[0].close ? '#166534' : '#991b1b',
              }}
            >
              {currentSpotPrice.toFixed(2)}
            </div>
          </>
        )}
        {/* Current pool price dotted line + pill - z-20 so it renders on top of everything */}
        {currentPriceYPx !== null && currentPrice !== null && (
          <>
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: 0,
                right: 0,
                top: `${currentPriceYPx}px`,
                borderTop: `1px dotted ${trendColor}`,
                opacity: 0.9,
              }}
            />
            <div
              className={`absolute pointer-events-none text-white text-[10px] font-semibold px-1.5 py-0.5 rounded z-20 ${trendBgClass}`}
              style={{
                left: `${chartMargin.left}px`,
                top: `${currentPriceYPx}px`,
                transform: 'translateY(-50%)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
              }}
            >
              {currentPrice.toFixed(2)}
            </div>
          </>
        )}

        <ResponsiveContainer width="100%" height={chartHeightPx}>
          <ComposedChart
            data={chartData}
            margin={chartMargin}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            {chartComponents}
          </ComposedChart>
        </ResponsiveContainer>
        {/* Vertical line overlay - only this rerenders on hover */}
        {hoverX !== null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${hoverX}px`,
              top: 0,
              bottom: 0,
              width: '1px',
              borderLeft: '1px dashed hsl(var(--muted-foreground))',
              opacity: 0.5,
            }}
          />
        )}
        {/* Horizontal line overlay + left price pill (hover) */}
        {hoverY !== null && (
          <>
            <div
              className="absolute pointer-events-none"
              style={{
                left: 0,
                right: 0,
                top: `${hoverY}px`,
                borderTop: '1px dashed hsl(var(--muted-foreground))',
                opacity: 0.5,
              }}
            />
            {hoverPriceRef.current !== null && (
              <div
                className="absolute pointer-events-none z-10"
                style={{
                  left: `${chartMargin.left}px`,
                  top: `${hoverY}px`,
                  transform: 'translateY(-50%)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                }}
              >
                <div className="bg-background/90 border border-border text-foreground text-[10px] font-semibold px-1.5 py-0.5 rounded">
                  {hoverPriceRef.current.toFixed(2)}
                </div>
              </div>
            )}
          </>
        )}
        {/* Hover timestamp pill aligned with vertical line */}
        {hoverX !== null && hoverLabelRef.current && (
          <div
            className="absolute pointer-events-none z-10"
            style={{
              left: `${hoverX}px`,
              bottom: 6,
              transform: 'translateX(-50%)',
              maxWidth: '90%',
              whiteSpace: 'nowrap',
            }}
          >
            <div className="bg-background/90 border border-border text-foreground text-[10px] font-medium px-1.5 py-0.5 rounded shadow-sm">
              {hoverLabelRef.current}
            </div>
          </div>
        )}
        {/* Pulsating dot at the latest price point */}
        {latestPointPosition && (
          <>
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: `${latestPointPosition.x}px`,
                top: `${latestPointPosition.y}px`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Outer pulsing ring */}
              <div
                className="absolute rounded-full"
                style={{
                  width: '12px',
                  height: '12px',
                  backgroundColor: trendColor,
                  opacity: 0.3,
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }}
              />
              {/* Inner solid dot */}
              <div
                className="absolute rounded-full"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '6px',
                  height: '6px',
                  backgroundColor: trendColor,
                  border: '2px solid white',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                }}
              />
            </div>
            <style>{`
              @keyframes pulse {
                0%, 100% {
                  opacity: 0.3;
                  transform: translate(-50%, -50%) scale(1);
                }
                50% {
                  opacity: 0.1;
                  transform: translate(-50%, -50%) scale(1.5);
                }
              }
            `}</style>
          </>
        )}
      </div>
      {showVolume && (
        <ResponsiveContainer width="100%" height={height * 0.3}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" opacity={0.3} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={volumeDomain}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              width={60}
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return value.toString();
              }}
            />
            <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, index) => {
                const isUp = entry.close >= entry.open;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isUp ? '#22c55e' : '#ef4444'}
                    opacity={0.6}
                  />
                );
              })}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

// Memoize the component to prevent unnecessary rerenders
export default memo(CandlestickChart);

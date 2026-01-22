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
}

interface CandlestickChartProps {
  data: OHLCData[];
  loading?: boolean;
  height?: number;
  showVolume?: boolean;
  chartType?: 'line' | 'candlestick';
  onHoverDataChange?: (data: any) => void;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({
  data,
  loading = false,
  height = 300,
  showVolume = true,
  chartType = 'line',
  onHoverDataChange,
}) => {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => ({
      ...d,
      date: format(new Date(d.timestamp), 'HH:mm'),
      fullDate: format(new Date(d.timestamp), 'MMM d, HH:mm'),
    }));
  }, [data]);

  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const allValues = chartData.flatMap((d) => [d.high, d.low]);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;
    return [Math.max(0, min - padding), max + padding];
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
    const percentChange = Math.abs((latestPrice - firstPrice) / firstPrice) * 100;
    
    // If within 1%, use blue
    if (percentChange <= 1) {
      return '#3b82f6'; // Blue
    }
    
    // Otherwise, green if up, red if down
    return latestPrice > firstPrice ? '#22c55e' : '#ef4444';
  }, [chartData, chartType]);

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
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={yAxisDomain}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          width={60}
          tickFormatter={(value) => {
            if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
            return `$${value.toFixed(2)}`;
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
          /* Simple line chart mode */
          <Line
            type="monotone"
            dataKey="close"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        )}
      </>
    );
  }, [chartType, yAxisDomain, height, showVolume, lineColor]);

  const handleMouseMove = useCallback((state: any) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const payload = state.activePayload[0].payload;
      // Call hover callback immediately for responsive updates
      if (onHoverDataChange) {
        onHoverDataChange(payload);
      }
      // Use the activeCoordinate from Recharts
      // The coordinate is in the SVG coordinate system
      // ResponsiveContainer makes the SVG fill the container, and Recharts handles margins internally
      // So activeCoordinate.x is already in the correct position relative to the container
      if (state.activeCoordinate) {
        setHoverX(state.activeCoordinate.x);
      }
    }
  }, [onHoverDataChange]);

  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
    if (onHoverDataChange) {
      onHoverDataChange(null);
    }
  }, [onHoverDataChange]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center" style={{ height }}>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

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
        <ResponsiveContainer width="100%" height={showVolume ? height * 0.7 : height}>
          <ComposedChart 
            data={chartData} 
            margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
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

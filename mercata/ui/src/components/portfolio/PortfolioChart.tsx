import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Token } from "@/interface";

interface PortfolioChartProps {
  tokens: Token[];
  currentValue: number;
}

const PortfolioChart = ({ tokens, currentValue }: PortfolioChartProps) => {
  const [timeRange, setTimeRange] = useState<"1D" | "1W" | "1M" | "3M" | "1Y" | "ALL">("1M");

  // Generate mock historical data based on current value
  // In a real app, this would come from an API
  const chartData = useMemo(() => {
    const dataPoints = {
      "1D": 24,
      "1W": 7,
      "1M": 30,
      "3M": 90,
      "1Y": 365,
      "ALL": 730,
    };

    const points = dataPoints[timeRange];
    const data = [];
    const now = new Date();
    
    // Generate realistic looking portfolio data with some volatility
    let baseValue = currentValue * 0.85; // Start at 85% of current value
    const dailyVolatility = 0.02; // 2% daily volatility
    const trend = currentValue > 0 ? (currentValue - baseValue) / points : 0; // Upward trend

    for (let i = 0; i < points; i++) {
      const date = new Date(now);
      if (timeRange === "1D") {
        date.setHours(date.getHours() - (points - i));
      } else {
        date.setDate(date.getDate() - (points - i));
      }

      // Add some random volatility with an upward trend
      const randomChange = (Math.random() - 0.5) * dailyVolatility * baseValue;
      baseValue = baseValue + trend + randomChange;
      
      // Make sure value doesn't go negative
      baseValue = Math.max(0, baseValue);

      data.push({
        date: date.toLocaleDateString(undefined, {
          month: timeRange === "1D" ? undefined : "short",
          day: timeRange === "1D" ? undefined : "numeric",
          hour: timeRange === "1D" ? "numeric" : undefined,
          minute: timeRange === "1D" ? "2-digit" : undefined,
        }),
        value: parseFloat(baseValue.toFixed(2)),
        timestamp: date.getTime(),
      });
    }

    // Add current value as the last point
    data.push({
      date: "Now",
      value: currentValue,
      timestamp: Date.now(),
    });

    return data;
  }, [currentValue, timeRange]);

  const changePercentage = useMemo(() => {
    if (chartData.length < 2) return 0;
    const firstValue = chartData[0].value;
    const lastValue = chartData[chartData.length - 1].value;
    return ((lastValue - firstValue) / firstValue) * 100;
  }, [chartData]);

  const changeAmount = useMemo(() => {
    if (chartData.length < 2) return 0;
    return chartData[chartData.length - 1].value - chartData[0].value;
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-medium">{payload[0].payload.date}</p>
          <p className="text-lg font-bold">${payload[0].value.toLocaleString()}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">${currentValue.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            <span className={`text-sm font-medium ${changePercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
              {changePercentage >= 0 ? "+" : ""}{changePercentage.toFixed(2)}% (${changeAmount >= 0 ? "+" : ""}{changeAmount.toFixed(2)})
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Portfolio Value</p>
        </div>
        <div className="flex gap-1">
          {(["1D", "1W", "1M", "3M", "1Y", "ALL"] as const).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="px-3"
            >
              {range}
            </Button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis 
            dataKey="date" 
            stroke="#888888"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="#888888"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `$${value.toLocaleString()}`}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#colorValue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PortfolioChart;
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from '@/components/ui/chart';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Dot,
} from "recharts";
import { Pool } from '@/interface';

interface LPProfitChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: Pool | null;
}

type ChartDataPoint = {
  date: string;
  holdValue: number;
  lpValue: number;
  timestamp: number;
  isDepositEvent?: boolean;
  depositInfo?: {
    tokenAAmount: number;
    tokenBAmount: number;
  };
};

type DepositEvent = {
  dayIndex: number; // Days from start
  tokenAAmount: number;
  tokenBAmount: number;
  priceAtDeposit: number; // Price of A in terms of B
};

// Generate dummy data for the chart with multiple deposits
const generateDummyData = (pool: Pool | null): ChartDataPoint[] => {
  if (!pool) return [];
  
  const dataPoints: ChartDataPoint[] = [];
  const now = Date.now();
  const daysAgo = 30; // Show last 30 days
  
  // Define deposit events - simulating multiple deposits at different times
  const deposits: DepositEvent[] = [
    {
      dayIndex: 0, // Initial deposit 30 days ago
      tokenAAmount: 5000, // $5000 worth of token A
      tokenBAmount: 5000, // $5000 worth of token B
      priceAtDeposit: 1.0, // 1 A = 1 B at deposit time
    },
    {
      dayIndex: 18, // Second deposit 12 days ago
      tokenAAmount: 3500, // $3500 worth of token A
      tokenBAmount: 2500, // $2500 worth of token B (different ratio)
      priceAtDeposit: 1.15, // Price has changed - 1 A = 1.15 B
    },
  ];
  
  // Track the "hold" basket - what tokens we'd have if we just held them
  const holdBasket = { tokenA: 0, tokenB: 0 };
  
  // Track LP position value components
  let totalLPTokens = 0; // Total LP tokens across all deposits
  let poolTokenAReserve = 0;
  let poolTokenBReserve = 0;
  
  // Simulate prices starting at 1.0 and evolving
  let currentPrice = 1.0; // Price of token A in terms of token B
  
  for (let i = daysAgo; i >= 0; i--) {
    const timestamp = now - (i * 24 * 60 * 60 * 1000);
    const date = new Date(timestamp);
    const dayIndex = daysAgo - i;
    
    // Simulate price movements
    const dailyChange = (Math.random() - 0.5) * 0.04; // 4% daily volatility
    const trendComponent = 0.0015; // 0.15% daily upward trend
    currentPrice *= (1 + dailyChange + trendComponent);
    
    // Check if there's a deposit on this day
    const depositEvent = deposits.find(d => d.dayIndex === dayIndex);
    const isDepositDay = !!depositEvent;
    
    if (depositEvent) {
      // Add tokens to hold basket
      holdBasket.tokenA += depositEvent.tokenAAmount / depositEvent.priceAtDeposit;
      holdBasket.tokenB += depositEvent.tokenBAmount;
      
      // For LP: simulate adding liquidity to pool
      // Initial deposit sets the pool
      if (totalLPTokens === 0) {
        poolTokenAReserve = depositEvent.tokenAAmount / depositEvent.priceAtDeposit;
        poolTokenBReserve = depositEvent.tokenBAmount;
        totalLPTokens = Math.sqrt(poolTokenAReserve * poolTokenBReserve); // K = sqrt(x*y)
      } else {
        // Subsequent deposits: calculate LP tokens proportionally
        const tokenAToDeposit = depositEvent.tokenAAmount / currentPrice;
        const tokenBToDeposit = depositEvent.tokenBAmount;
        
        // Add to reserves (simplified - in reality would involve swaps for single-sided)
        const lpTokensMinted = Math.min(
          (tokenAToDeposit / poolTokenAReserve) * totalLPTokens,
          (tokenBToDeposit / poolTokenBReserve) * totalLPTokens
        );
        
        poolTokenAReserve += tokenAToDeposit;
        poolTokenBReserve += tokenBToDeposit;
        totalLPTokens += lpTokensMinted;
      }
    }
    
    // Calculate hold value: value of tokens we're holding at current prices
    const holdValue = (holdBasket.tokenA * currentPrice) + holdBasket.tokenB;
    
    // Calculate LP value: value of LP position at current prices
    // Simulate pool reserves changing based on price (constant product formula)
    // When price increases, arbitrageurs trade until pool reflects market price
    let lpValue = 0;
    if (totalLPTokens > 0) {
      // Pool maintains k = x * y, and price = y / x
      // So if price changes, reserves adjust
      const k = poolTokenAReserve * poolTokenBReserve;
      const adjustedReserveA = Math.sqrt(k / currentPrice);
      const adjustedReserveB = Math.sqrt(k * currentPrice);
      
      // Add accumulated fees (simplified)
      const daysSinceStart = daysAgo - i;
      const feeMultiplier = 1 + (daysSinceStart * 0.0008); // 0.08% daily fees
      
      lpValue = (adjustedReserveA * currentPrice + adjustedReserveB) * feeMultiplier;
    }
    
    dataPoints.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      holdValue: parseFloat(holdValue.toFixed(2)),
      lpValue: parseFloat(lpValue.toFixed(2)),
      timestamp,
      isDepositEvent: isDepositDay,
      depositInfo: depositEvent ? {
        tokenAAmount: depositEvent.tokenAAmount,
        tokenBAmount: depositEvent.tokenBAmount,
      } : undefined,
    });
  }
  
  return dataPoints;
};

const LPProfitChartModal = ({ isOpen, onClose, selectedPool }: LPProfitChartModalProps) => {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);

  useEffect(() => {
    if (selectedPool && isOpen) {
      const data = generateDummyData(selectedPool);
      setChartData(data);
    }
  }, [selectedPool, isOpen]);

  if (!selectedPool) return null;

  const latestData = chartData[chartData.length - 1];
  const profitLoss = latestData ? latestData.lpValue - latestData.holdValue : 0;
  const profitLossPercent = latestData ? ((profitLoss / latestData.holdValue) * 100).toFixed(2) : '0';
  const isProfit = profitLoss >= 0;

  const formatCurrency = (value: number) => {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatTooltipValue = (value: number) => {
    return formatCurrency(value);
  };

  // Calculate optimal y-axis domain to zoom into the data
  const calculateYAxisDomain = (): [number, number] => {
    if (chartData.length === 0) return [0, 10000];

    // Get all values from both lines
    const allValues = chartData.flatMap(point => [point.holdValue, point.lpValue]);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = maxValue - minValue;

    // Use adaptive padding based on range size
    // Smaller ranges get more padding to avoid over-zooming
    let paddingPercent: number;
    if (range < maxValue * 0.01) {
      // If range is less than 1% of max value, use 10% padding
      paddingPercent = 0.10;
    } else if (range < maxValue * 0.05) {
      // If range is less than 5% of max value, use 8% padding
      paddingPercent = 0.08;
    } else {
      // For larger ranges, use 5% padding to show more detail
      paddingPercent = 0.05;
    }

    const padding = range * paddingPercent;
    
    // Ensure we never go below 0
    const yMin = Math.max(0, minValue - padding);
    const yMax = maxValue + padding;

    return [yMin, yMax];
  };

  const [yMin, yMax] = calculateYAxisDomain();

  // Get deposit events for markers
  const depositEvents = chartData.filter(point => point.isDepositEvent);

  // Custom dot renderer to show deposit markers
  const renderDepositDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.isDepositEvent) {
      return (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={3} fill="#fff" />
        </g>
      );
    }
    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>LP Performance: {selectedPool.poolName}</DialogTitle>
          <DialogDescription>
            Compare your LP position value vs. simply holding the tokens
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground mb-1">Current Hold Value</div>
              <div className="text-2xl font-bold">
                {latestData ? formatCurrency(latestData.holdValue) : '-'}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground mb-1">Current LP Value</div>
              <div className="text-2xl font-bold">
                {latestData ? formatCurrency(latestData.lpValue) : '-'}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm text-muted-foreground mb-1">Profit/Loss vs Hold</div>
              <div className={`text-2xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {isProfit ? '+' : ''}{formatCurrency(profitLoss)}
              </div>
              <div className={`text-sm ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {isProfit ? '+' : ''}{profitLossPercent}%
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-lg border p-4">
            <h3 className="text-lg font-semibold mb-4">30-Day Performance Comparison</h3>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-80 bg-muted/50 rounded-md">
                <p className="text-muted-foreground">Loading chart data...</p>
              </div>
            ) : (
              <div className="w-full h-80">
                <ChartContainer
                  config={{
                    holdValue: {
                      label: "Hold Value",
                      color: "#3b82f6",
                    },
                    lpValue: {
                      label: "LP Value",
                      color: isProfit ? "#22c55e" : "#ef4444",
                    },
                  }}
                  className="w-full h-full"
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10 }}
                        tickCount={8}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 12 }}
                        width={80}
                        domain={[yMin, yMax]}
                        tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                      />
                      <ChartTooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          
                          const dataPoint = payload[0].payload as ChartDataPoint;
                          
                          return (
                            <div className="rounded-lg border bg-background p-2 shadow-xl">
                              <div className="font-medium mb-2">{label}</div>
                              <div className="space-y-1">
                                {payload.map((entry) => (
                                  <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-xs">
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="h-2 w-2 rounded-sm"
                                        style={{ backgroundColor: entry.color }}
                                      />
                                      <span className="text-muted-foreground">
                                        {entry.dataKey === 'holdValue' ? 'Hold Value' : 'LP Value'}
                                      </span>
                                    </div>
                                    <span className="font-mono font-medium">
                                      {formatTooltipValue(Number(entry.value))}
                                    </span>
                                  </div>
                                ))}
                                {dataPoint.isDepositEvent && dataPoint.depositInfo && (
                                  <div className="mt-2 pt-2 border-t border-border">
                                    <div className="flex items-center gap-1 text-amber-600 font-medium text-xs mb-1">
                                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                                      <span>Deposit Event</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      +${dataPoint.depositInfo.tokenAAmount.toLocaleString()} Token A
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      +${dataPoint.depositInfo.tokenBAmount.toLocaleString()} Token B
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />
                      <ChartLegend
                        content={<ChartLegendContent />}
                      />
                      <Line
                        type="monotone"
                        dataKey="holdValue"
                        name="Hold Value"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={renderDepositDot}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="lpValue"
                        name="LP Value"
                        stroke={isProfit ? "#22c55e" : "#ef4444"}
                        strokeWidth={2}
                        dot={renderDepositDot}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            )}
          </div>

          {/* Deposit History */}
          {depositEvents.length > 0 && (
            <div className="rounded-lg border p-4">
              <h4 className="font-semibold mb-3">Deposit History</h4>
              <div className="space-y-2">
                {depositEvents.map((event, idx) => (
                  <div key={idx} className="flex items-start gap-3 text-sm">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500 text-white font-bold text-xs flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{event.date}</div>
                      <div className="text-muted-foreground text-xs">
                        ${event.depositInfo?.tokenAAmount.toLocaleString()} Token A + ${event.depositInfo?.tokenBAmount.toLocaleString()} Token B
                      </div>
                    </div>
                    <div className="text-right text-muted-foreground text-xs">
                      Total: ${((event.depositInfo?.tokenAAmount || 0) + (event.depositInfo?.tokenBAmount || 0)).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="rounded-lg bg-muted/50 p-4">
            <h4 className="font-semibold mb-2">Understanding the Chart</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• <span className="text-blue-600 font-medium">Blue line</span>: Value if you held all deposited tokens without providing liquidity</li>
              <li>• <span className={`${isProfit ? 'text-green-600' : 'text-red-600'} font-medium`}>{isProfit ? 'Green' : 'Red'} line</span>: Current value of your LP position (including earned fees and impermanent loss)</li>
              <li>• <span className="text-amber-600 font-medium">Orange dots</span>: Deposit events - when you added liquidity to the pool</li>
              <li>• Both lines increase at deposit events as you invest more capital</li>
              <li>• When the LP line is above the hold line, you're earning more than simply holding</li>
              <li>• When the LP line is below, impermanent loss exceeds trading fees earned</li>
            </ul>
          </div>

          {/* Disclaimer */}
          <div className="text-xs text-muted-foreground italic">
            Note: This chart uses simulated data for demonstration purposes, including multiple deposits at different times and ratios. 
            Actual performance may vary based on market conditions, trading volume, pool parameters, and your specific deposit history. 
            The "Hold Value" represents what your tokens would be worth if you held them instead of providing liquidity, 
            accounting for all deposits made over time.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LPProfitChartModal;

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Wallet, CreditCard, PieChart } from "lucide-react";
import { Token } from "@/interface";
import { formatUnits } from "viem";
import { useMemo } from "react";

interface PortfolioStatsProps {
  totalBalance: number;
  totalDebt: number;
  netWorth: number;
  tokens: Token[];
}

const PortfolioStats = ({ totalBalance, totalDebt, netWorth, tokens }: PortfolioStatsProps) => {
  // Calculate 24h change (mock data for now, in real app would come from API)
  const twentyFourHourChange = useMemo(() => {
    // Mock: assume 2.5% gain in last 24h
    const changePercent = 2.5;
    const changeAmount = netWorth * (changePercent / 100);
    return { percent: changePercent, amount: changeAmount };
  }, [netWorth]);

  // Calculate number of assets
  const activeAssets = tokens.filter(t => {
    const balance = parseFloat(formatUnits(BigInt(t.balance || "0"), 18));
    const collateralBalance = parseFloat(formatUnits(BigInt(t.collateralBalance || "0"), 18));
    return (balance + collateralBalance) > 0;
  }).length;

  // Calculate best performing asset (mock data)
  const bestPerformer = useMemo(() => {
    if (tokens.length === 0) return null;
    // In real app, this would compare current vs previous prices
    const topToken = tokens.reduce((best, token) => {
      const balance = parseFloat(formatUnits(BigInt(token.balance || "0"), 18));
      const bestBalance = parseFloat(formatUnits(BigInt(best.balance || "0"), 18));
      return balance > bestBalance ? token : best;
    }, tokens[0]);
    
    return {
      symbol: topToken._symbol,
      change: 15.2, // Mock percentage
    };
  }, [tokens]);

  const stats = [
    {
      title: "Net Worth",
      value: `$${netWorth.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      change: twentyFourHourChange.percent,
      changeAmount: `$${Math.abs(twentyFourHourChange.amount).toFixed(2)}`,
      icon: <DollarSign className="h-4 w-4" />,
      iconBg: "bg-blue-500",
      trend: twentyFourHourChange.percent >= 0,
    },
    {
      title: "Total Assets",
      value: `$${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      subtitle: `${activeAssets} active positions`,
      icon: <Wallet className="h-4 w-4" />,
      iconBg: "bg-green-500",
    },
    {
      title: "Total Debt",
      value: `$${totalDebt.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
      subtitle: totalDebt > 0 ? "Active loans" : "No active loans",
      icon: <CreditCard className="h-4 w-4" />,
      iconBg: "bg-red-500",
    },
    {
      title: "Best Performer",
      value: bestPerformer ? bestPerformer.symbol : "N/A",
      change: bestPerformer?.change,
      subtitle: bestPerformer ? "24h change" : "No data",
      icon: <TrendingUp className="h-4 w-4" />,
      iconBg: "bg-purple-500",
      trend: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <Card key={index} className="relative overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">{stat.title}</p>
                <p className="text-2xl font-bold mt-2">{stat.value}</p>
                
                {stat.change !== undefined && (
                  <div className="flex items-center gap-1 mt-2">
                    {stat.trend ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <span className={`text-sm font-medium ${stat.trend ? "text-green-600" : "text-red-600"}`}>
                      {stat.trend ? "+" : ""}{stat.change.toFixed(2)}%
                    </span>
                    {stat.changeAmount && (
                      <span className="text-sm text-gray-500">({stat.changeAmount})</span>
                    )}
                  </div>
                )}
                
                {stat.subtitle && !stat.change && (
                  <p className="text-sm text-gray-500 mt-2">{stat.subtitle}</p>
                )}
              </div>
              
              <div className={`${stat.iconBg} p-3 rounded-lg text-white`}>
                {stat.icon}
              </div>
            </div>
            
            {/* Decorative gradient */}
            <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
              <div className={`w-full h-full ${stat.iconBg} rounded-full blur-3xl`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PortfolioStats;
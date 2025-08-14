import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Token } from "@/interface";
import { formatUnits } from "viem";

interface AssetAllocationProps {
  tokens: Token[];
}

const AssetAllocation = ({ tokens }: AssetAllocationProps) => {
  // Calculate allocation data
  const allocationData = useMemo(() => {
    const tokenValues = tokens.map(token => {
      const balance = parseFloat(formatUnits(BigInt(token.balance || "0"), 18));
      const collateralBalance = parseFloat(formatUnits(BigInt(token.collateralBalance || "0"), 18));
      const price = parseFloat(formatUnits(BigInt(token.price || "0"), 18));
      const totalBalance = balance + collateralBalance;
      const value = totalBalance * price;
      
      return {
        name: token._symbol,
        value: parseFloat(value.toFixed(2)),
        balance: totalBalance,
        price: price,
      };
    }).filter(item => item.value > 0);

    // Sort by value and group small holdings
    tokenValues.sort((a, b) => b.value - a.value);
    
    const totalValue = tokenValues.reduce((sum, item) => sum + item.value, 0);
    
    // Group tokens with less than 5% into "Others"
    const threshold = totalValue * 0.05;
    const mainTokens: any[] = [];
    let othersValue = 0;
    
    tokenValues.forEach(token => {
      if (token.value >= threshold && mainTokens.length < 5) {
        mainTokens.push({
          ...token,
          percentage: ((token.value / totalValue) * 100).toFixed(1),
        });
      } else {
        othersValue += token.value;
      }
    });
    
    if (othersValue > 0) {
      mainTokens.push({
        name: "Others",
        value: othersValue,
        percentage: ((othersValue / totalValue) * 100).toFixed(1),
      });
    }
    
    return mainTokens;
  }, [tokens]);

  // Color palette for the pie chart
  const COLORS = [
    "#3B82F6", // Blue
    "#8B5CF6", // Purple
    "#10B981", // Green
    "#F59E0B", // Amber
    "#EF4444", // Red
    "#6B7280", // Gray for "Others"
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload[0]) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-medium">{payload[0].name}</p>
          <p className="text-sm text-gray-600">
            Value: ${payload[0].value.toLocaleString()}
          </p>
          <p className="text-sm text-gray-600">
            Allocation: {payload[0].payload.percentage}%
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percentage }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (parseFloat(percentage) < 5) return null; // Don't show label for small slices

    return (
      <text 
        x={x} 
        y={y} 
        fill="white" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        className="font-medium text-sm"
      >
        {`${percentage}%`}
      </text>
    );
  };

  if (allocationData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-gray-500">
        <div className="text-center">
          <p className="text-lg font-medium">No assets to display</p>
          <p className="text-sm mt-1">Start by depositing some assets</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={allocationData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={CustomLabel}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {allocationData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {allocationData.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-sm">
              {entry.name} ({entry.percentage}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AssetAllocation;
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cdpService, BadDebt } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import JuniorNotesView from "./JuniorNotesView";

// Convert wei string to decimal for display (handles raw integer strings from backend)
const formatWeiToDecimal = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const quotient = wei / divisor;
  const remainder = wei % divisor;
  
  if (remainder === 0n) {
    return quotient.toString();
  }
  
  // For non-zero remainder, show decimal places
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalPart.replace(/0+$/, ''); // Remove trailing zeros
  
  if (trimmedDecimal === '') {
    return quotient.toString();
  }
  
  return `${quotient}.${trimmedDecimal}`;
};

// Format large numbers for display
const formatNumber = (num: number | string, decimals: number = 2): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  // For very large numbers, use scientific notation
  if (value >= 1e21) {
    return value.toExponential(2);
  }
  
  // For large numbers, use K/M/B notation
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  
  // For normal numbers, limit decimal places
  return value.toFixed(decimals);
};

const BadDebtView: React.FC = () => {
  const [badDebtData, setBadDebtData] = useState<BadDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalBadDebt, setTotalBadDebt] = useState<number>(0);
  const { toast } = useToast();

  useEffect(() => {
    const fetchBadDebtData = async () => {
      setLoading(true);
      try {
        const data = await cdpService.getBadDebt();
        setBadDebtData(data);
        
        // Calculate total bad debt
        const total = data.reduce((sum, item) => {
          const debtAmount = parseFloat(formatWeiToDecimal(item.badDebt, 18));
          return sum + debtAmount;
        }, 0);
        
        setTotalBadDebt(total);
      } catch (error) {
        console.error("Failed to fetch bad debt data:", error);
        toast({
          title: "Error",
          description: "Failed to load bad debt information",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchBadDebtData();
  }, [toast]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">Loading bad debt information...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Bad Debt Display */}
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Total Bad Debt</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600">
              {formatNumber(totalBadDebt)} USDST
            </div>
            <p className="text-sm text-gray-600 mt-2">
              Total bad debt across all collateral assets
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Bad Debt Details */}
      <Card>
        <CardHeader>
          <CardTitle>Bad Debt by Asset</CardTitle>
        </CardHeader>
        <CardContent>
          {badDebtData.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No bad debt found
            </div>
          ) : (
            <div className="space-y-3">
              {badDebtData.map((item, index) => {
                const debtAmount = parseFloat(formatWeiToDecimal(item.badDebt, 18));
                return (
                  <div key={`${item.asset}-${index}`} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-xs font-semibold text-red-700">
                        {item.asset.slice(2, 4).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">Asset</div>
                        <div className="text-sm text-gray-500 font-mono">
                          {item.asset.slice(0, 6)}...{item.asset.slice(-4)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-red-600">
                        ${formatNumber(debtAmount)} USDST
                      </div>
                      <div className="text-sm text-gray-500">
                        {((debtAmount / totalBadDebt) * 100).toFixed(1)}% of total
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Junior Notes Section */}
      <JuniorNotesView badDebtData={badDebtData} />
    </div>
  );
};

export default BadDebtView;

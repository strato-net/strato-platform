import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cdpService, BadDebt } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle } from "lucide-react";
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
  const [refreshing, setRefreshing] = useState(false);
  const [totalBadDebt, setTotalBadDebt] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchBadDebtData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    setError(null);
    
    try {
      console.log('Fetching fresh bad debt data from blockchain...');
      const data = await cdpService.getBadDebt();
      console.log('Bad debt data received:', data);
      
      setBadDebtData(data);
      
      // Calculate total bad debt
      const total = data.reduce((sum, item) => {
        const debtAmount = parseFloat(formatWeiToDecimal(item.badDebt, 18));
        return sum + debtAmount;
      }, 0);
      
      setTotalBadDebt(total);
      setLastUpdated(new Date());
      
      // Log summary
      console.log(`Total bad debt: ${formatNumber(total)} USDST across ${data.length} assets`);
      
    } catch (error: any) {
      console.error("Failed to fetch bad debt data:", error);
      const errorMessage = error.response?.data?.message || error.message || "Failed to load bad debt information";
      setError(errorMessage);
      toast({
        title: "Error",
        description: `Failed to load on-chain bad debt data: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchBadDebtData();
  }, [fetchBadDebtData]);

  const handleRefresh = () => {
    fetchBadDebtData(true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
              <div>Loading on-chain bad debt data...</div>
            </div>
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
          <CardTitle className="flex items-center justify-between">
            <span>Total Bad Debt</span>
            <div className="flex items-center gap-2">
              {lastUpdated && (
                <Badge variant="outline" className="text-xs">
                  Updated: {lastUpdated.toLocaleTimeString()}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <div className="text-red-600 font-medium mb-2">Failed to load on-chain data</div>
              <div className="text-sm text-gray-600 mb-4">{error}</div>
              <Button onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600">
                {formatNumber(totalBadDebt)} USDST
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Total bad debt across all collateral assets (on-chain)
              </p>
              {badDebtData.length > 0 && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Live data from blockchain
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bad Debt Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Bad Debt by Asset</span>
            <Badge variant="secondary" className="text-xs">
              {badDebtData.length} Assets
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8 text-gray-500">
              Error loading asset-specific data
            </div>
          ) : badDebtData.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-500 mb-2">No bad debt found on-chain</div>
              <div className="text-xs text-green-600">✓ All assets healthy</div>
            </div>
          ) : (
            <div className="space-y-3">
              {badDebtData.map((item, index) => {
                const debtAmount = parseFloat(formatWeiToDecimal(item.badDebt, 18));
                const percentOfTotal = totalBadDebt > 0 ? ((debtAmount / totalBadDebt) * 100) : 0;
                const symbol = item.symbol || "UNKNOWN";
                const displayName = symbol !== "UNKNOWN" ? symbol : `Asset #${index + 1}`;
                return (
                  <div key={`${item.asset}-${index}`} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-xs font-semibold text-red-700">
                        {symbol !== "UNKNOWN" ? symbol.slice(0, 3).toUpperCase() : item.asset.slice(2, 4).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{displayName}</div>
                        <div className="text-sm text-gray-500 font-mono">
                          {item.asset.slice(0, 8)}...{item.asset.slice(-6)}
                        </div>
                        <div className="text-xs text-blue-600 mt-1">
                          📊 On-chain data {symbol !== "UNKNOWN" ? "• " + symbol : ""}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-red-600">
                        {formatNumber(debtAmount)} USDST
                      </div>
                      <div className="text-sm text-gray-500">
                        {percentOfTotal.toFixed(1)}% of total
                      </div>
                      <div className="text-xs text-gray-400">
                        {formatWeiToDecimal(item.badDebt, 18)} exact
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-blue-800">
                  <strong>Real-time Data:</strong> Bad debt values are fetched directly from the CDP Engine smart contract via Cirrus.
                  Values update automatically when liquidations occur or bad debt is written off.
                </div>
              </div>
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

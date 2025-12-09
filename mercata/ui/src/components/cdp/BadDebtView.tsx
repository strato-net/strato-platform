import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cdpService, BadDebt } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { formatWeiToDecimalHP, formatNumber } from "@/utils/numberUtils";
import JuniorNoteView from "./JuniorNoteView";


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
      const data = await cdpService.getBadDebt();
      
      setBadDebtData(data);
      
      // Calculate total bad debt
      const total = data.reduce((sum, item) => {
        const debtAmount = parseFloat(formatWeiToDecimalHP(item.badDebt, 18));
        return sum + debtAmount;
      }, 0);
      
      setTotalBadDebt(total);
      setLastUpdated(new Date());
  
      
    } catch (error) {
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
              <div className="text-sm text-muted-foreground mb-4">{error}</div>
              <Button onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                {formatNumber(totalBadDebt)} USDST
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Total bad debt across all collateral assets (on-chain)
              </p>
            </div>
          )}
        </CardContent>
      </Card>


      {/* Junior Note Section */}
      <JuniorNoteView 
        badDebtData={badDebtData} 
        onBadDebtUpdate={() => fetchBadDebtData(true)}
      />
    </div>
  );
};

export default BadDebtView;

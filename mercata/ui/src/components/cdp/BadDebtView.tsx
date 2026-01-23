import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cdpService, BadDebt } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { formatWeiToDecimalHP, formatNumber } from "@/utils/numberUtils";
import JuniorNoteView from "./JuniorNoteView";

interface BadDebtViewProps {
  guestMode?: boolean;
}

const BadDebtView: React.FC<BadDebtViewProps> = ({ guestMode = false }) => {
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
    // Fetch bad debt data for both logged-in and guest users (protocol-level data)
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
        <CardHeader className="px-4 md:px-6 pb-2 md:pb-4">
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="text-base md:text-xl whitespace-nowrap">Total Bad Debt</span>
            <div className="flex items-center gap-1 md:gap-2">
              {lastUpdated && (
                <Badge variant="outline" className="text-[10px] md:text-xs whitespace-nowrap px-1.5 md:px-2.5">
                  Updated: {lastUpdated.toLocaleTimeString()}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="shrink-0 h-7 w-7 md:h-8 md:w-8 p-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 md:h-4 md:w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          {error ? (
            <div className="text-center py-6 md:py-8">
              <AlertTriangle className="h-10 w-10 md:h-12 md:w-12 text-red-500 mx-auto mb-3 md:mb-4" />
              <div className="text-red-600 font-medium mb-2 text-sm md:text-base">Failed to load on-chain data</div>
              <div className="text-xs md:text-sm text-muted-foreground mb-4">{error}</div>
              <Button onClick={handleRefresh} disabled={refreshing} size="sm">
                {refreshing ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-2xl md:text-3xl font-bold text-red-600 dark:text-red-400">
                {formatNumber(totalBadDebt)} USDST
              </div>
              <p className="text-xs md:text-sm text-muted-foreground mt-2">
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
        guestMode={guestMode}
      />
    </div>
  );
};

export default BadDebtView;

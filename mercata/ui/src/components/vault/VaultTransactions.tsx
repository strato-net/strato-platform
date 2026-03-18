import { Loader2, RefreshCw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUnits } from "ethers";
import { useVaultContext } from "@/context/VaultContext";

const formatTimestamp = (timestamp: string): string => {
  if (!timestamp) return "N/A";
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return "N/A";
  }
};

const formatTokenAmount = (value: string, decimals: number = 18): string => {
  try {
    const num = parseFloat(formatUnits(value, decimals));
    if (num === 0) return "0";
    if (num < 0.0001) return "<0.0001";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    });
  } catch {
    return "0";
  }
};

const VaultTransactions = () => {
  const { vaultState, refreshTransactions } = useVaultContext();
  const { transactions, loadingTransactions } = vaultState;

  const handleRefresh = () => {
    refreshTransactions(false);
  };

  if (loadingTransactions && transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Vault Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Vault Activity</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={loadingTransactions}
        >
          <RefreshCw className={`h-4 w-4 ${loadingTransactions ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No recent transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {tx.type === "liquidation" ? (
                          <Zap className="h-4 w-4 text-orange-600" />
                        ) : (
                          <RefreshCw className="h-4 w-4 text-blue-600" />
                        )}
                        <Badge variant={tx.type === "liquidation" ? "destructive" : "secondary"}>
                          {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(tx.timestamp)}
                    </TableCell>
                    <TableCell>
                      {tx.type === "liquidation" && tx.liquidation ? (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="font-mono">{formatTokenAmount(tx.liquidation.collateralSeized)}</span>
                          <span className="text-muted-foreground">{tx.liquidation.assetSymbol}</span>
                          <span className="text-muted-foreground">seized</span>
                          <span className="text-muted-foreground">for</span>
                          <span className="font-mono">{formatTokenAmount(tx.liquidation.debtBurnedUSD)}</span>
                          <span className="text-muted-foreground">USDST</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {tx.tokenIn && (
                            <div className="flex items-center gap-1 text-sm">
                              <span className="text-red-600">-</span>
                              <span className="font-mono">{formatTokenAmount(tx.tokenIn.amount)}</span>
                              <span className="text-muted-foreground">{tx.tokenIn.symbol}</span>
                            </div>
                          )}
                          {tx.tokenOut && (
                            <div className="flex items-center gap-1 text-sm">
                              <span className="text-green-600">+</span>
                              <span className="font-mono">{formatTokenAmount(tx.tokenOut.amount)}</span>
                              <span className="text-muted-foreground">{tx.tokenOut.symbol}</span>
                            </div>
                          )}
                          {!tx.tokenIn && !tx.tokenOut && (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VaultTransactions;

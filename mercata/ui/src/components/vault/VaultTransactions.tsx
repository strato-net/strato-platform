import { useState, useEffect, useCallback } from "react";
import { Loader2, ArrowUpRight, ArrowDownLeft, RefreshCw, ExternalLink } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/axios";
import { formatUnits } from "ethers";

export interface VaultTransaction {
  id: string;
  type: "deposit" | "withdraw" | "rebalance" | "swap" | "other";
  timestamp: string;
  txHash: string;
  tokenIn?: {
    address: string;
    symbol: string;
    amount: string;
  };
  tokenOut?: {
    address: string;
    symbol: string;
    amount: string;
  };
  usdValue?: string;
  status: "success" | "pending" | "failed";
}

const formatAddress = (address: string): string => {
  if (!address) return "N/A";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

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

const formatUsd = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value, 18));
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const getTransactionIcon = (type: string) => {
  switch (type) {
    case "deposit":
      return <ArrowDownLeft className="h-4 w-4 text-green-600" />;
    case "withdraw":
      return <ArrowUpRight className="h-4 w-4 text-red-600" />;
    case "rebalance":
    case "swap":
      return <RefreshCw className="h-4 w-4 text-blue-600" />;
    default:
      return <RefreshCw className="h-4 w-4 text-gray-600" />;
  }
};

const getTransactionBadgeColor = (type: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (type) {
    case "deposit":
      return "default";
    case "withdraw":
      return "destructive";
    case "rebalance":
    case "swap":
      return "secondary";
    default:
      return "outline";
  }
};

const getStatusBadgeColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "success":
      return "default";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
};

const VaultTransactions = () => {
  const [transactions, setTransactions] = useState<VaultTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTransactions = useCallback(async (showLoading: boolean = true) => {
    if (showLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await api.get("/vault/transactions", {
        params: { limit: 20 },
      });

      if (res.data?.transactions) {
        setTransactions(res.data.transactions);
      }
    } catch (err) {
      console.error("Error fetching vault transactions:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(true);

    // Poll every 30 seconds
    const interval = setInterval(() => {
      fetchTransactions(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchTransactions]);

  const handleRefresh = () => {
    fetchTransactions(false);
  };

  if (loading) {
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
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
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
                  <TableHead className="text-right">Value (USD)</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getTransactionIcon(tx.type)}
                        <Badge variant={getTransactionBadgeColor(tx.type)}>
                          {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(tx.timestamp)}
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {tx.usdValue ? `$${formatUsd(tx.usdValue)}` : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={getStatusBadgeColor(tx.status)}>
                        {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => {
                                // Could link to block explorer
                                navigator.clipboard.writeText(tx.txHash);
                              }}
                            >
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{formatAddress(tx.txHash)}</p>
                            <p className="text-xs text-muted-foreground">Click to copy</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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

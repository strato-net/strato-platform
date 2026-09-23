import { useEffect, useState } from "react";
import { ChartNoAxesCombined, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUser } from "@/context/UserContext";
import { useTradeHistory } from "@/hooks/trade/useTradeHistory";
import { formatHash, formatWeiAmount } from "@/utils/numberUtils";

const ITEMS_PER_PAGE = 10;

interface PairSwapHistoryProps {
  tokenIn?: string;
  tokenOut?: string;
}

const PairSwapHistory = ({ tokenIn, tokenOut }: PairSwapHistoryProps) => {
  const { userAddress } = useUser();
  const [page, setPage] = useState(1);
  const [myTradesOnly, setMyTradesOnly] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [tokenIn, tokenOut, myTradesOnly]);

  const historyQuery = useTradeHistory({
    tokenIn,
    tokenOut,
    page,
    limit: ITEMS_PER_PAGE,
    sender: myTradesOnly ? userAddress : undefined,
  });
  const entries = historyQuery.data?.entries ?? [];
  const totalCount = historyQuery.data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const copyHash = async (hash: string) => {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/60 px-4 py-4 md:px-6">
        <div>
          <CardTitle className="text-base">Pair History</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Market-wide swaps for the selected STRATO pair.
          </p>
        </div>
        {userAddress && (
          <Button
            variant={myTradesOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setMyTradesOnly((value) => !value)}
            disabled={!tokenIn || !tokenOut || historyQuery.isFetching}
          >
            {myTradesOnly ? "Showing My Trades" : "Show My Trades"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 p-4 md:p-6">
        <div className="overflow-x-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {historyQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : entries.length > 0 ? (
              entries.map((swap) => (
                <TableRow key={`${swap.poolAddress}-${swap.id}`}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {swap.timestamp.toLocaleString()}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatWeiAmount(swap.amountIn)} {swap.tokenIn}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatWeiAmount(swap.amountOut)} {swap.tokenOut}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {swap.poolName || "V2"}
                  </TableCell>
                  <TableCell>
                    {swap.transactionHash ? (
                      <button
                        className="flex items-center gap-1 font-mono text-xs hover:text-blue-600"
                        onClick={() => copyHash(swap.transactionHash!)}
                      >
                        {copiedHash === swap.transactionHash
                          ? "Copied!"
                          : formatHash(swap.transactionHash)}
                        <Copy className="h-3 w-3" />
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <ChartNoAxesCombined className="mx-auto mb-2 h-7 w-7 opacity-30" />
                  <span className="text-sm">
                    {tokenIn && tokenOut
                      ? "No swap history found for this pair"
                      : "Choose Trade on STRATO to view pair history"}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{totalCount} trades</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => value - 1)}
              disabled={page === 1 || historyQuery.isFetching}
            >
              Previous
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => value + 1)}
              disabled={page === totalPages || historyQuery.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      </CardContent>
    </Card>
  );
};

export default PairSwapHistory;

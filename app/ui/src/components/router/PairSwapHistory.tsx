import { useEffect, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="mt-6 space-y-3 border-t pt-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Pair Swap History</h3>
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
      </div>
      <div className="overflow-x-auto rounded-lg border">
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
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No swap history found for this pair
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
    </div>
  );
};

export default PairSwapHistory;

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Loader2 } from 'lucide-react';
import { useTradeForm } from '@/context/TradeFormContext';
import { useTradeHistory } from '@/hooks/trade/useTradeHistory';
import { useUser } from '@/context/UserContext';
import { SwapHistoryEntry } from '@/interface';
import { formatWeiAmount, formatHash } from '@/utils/numberUtils';

// ============================================================================
// CONSTANTS
// ============================================================================
const ITEMS_PER_PAGE = 10;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
const formatTimestamp = (timestamp: Date) => {
  return timestamp.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

// ============================================================================
// UI COMPONENTS
// ============================================================================
const LoadingRow = ({ colSpan }: { colSpan: number }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center py-8">
      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
    </TableCell>
  </TableRow>
);

const EmptyRow = ({ colSpan }: { colSpan: number }) => (
  <TableRow>
    <TableCell colSpan={colSpan} className="text-center py-8">
      <p className="text-muted-foreground">No trades yet for this pair — make the first trade to get started.</p>
    </TableCell>
  </TableRow>
);

const SenderCell = ({ sender, copiedHash, onCopy }: { sender: string; copiedHash: string | null; onCopy: (text: string) => void }) => (
  <TableCell className="font-mono text-xs">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onCopy(sender)}
            className="flex items-center gap-1 hover:text-primary hover:bg-primary/10 active:bg-primary/20 active:scale-95 transition-[color,background-color,transform] duration-150 rounded px-1 py-0.5"
          >
            <span>
              {copiedHash === sender ? 'Copied!' : formatHash(sender)}
            </span>
            <Copy className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Click to copy full address</p>
          <p className="font-mono text-xs break-all">{sender}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </TableCell>
);

const SwapRow = ({ swap, copiedHash, onCopy }: { swap: SwapHistoryEntry & { timestamp: Date }; copiedHash: string | null; onCopy: (text: string) => void }) => (
  <TableRow key={swap.id}>
    <TableCell className="text-sm">
      {formatTimestamp(swap.timestamp)}
    </TableCell>
    <TableCell className="font-medium text-sm">
      {swap.tokenIn}
    </TableCell>
    <TableCell className="text-sm tabular-nums">
      {formatWeiAmount(swap.amountIn)}
    </TableCell>
    <TableCell className="font-medium text-sm">
      {swap.tokenOut}
    </TableCell>
    <TableCell className="text-sm tabular-nums">
      {formatWeiAmount(swap.amountOut)}
    </TableCell>
    <TableCell className="text-sm tabular-nums">
      {swap.tokenIn === 'USDST' || swap.tokenOut === 'USDST' ? '$' : ''}{swap.impliedPrice}
    </TableCell>
    <TableCell className="text-sm text-muted-foreground">
      {swap.poolName || 'V2'}
    </TableCell>
    <SenderCell sender={swap.sender} copiedHash={copiedHash} onCopy={onCopy} />
  </TableRow>
);

const PaginationInfo = ({ currentPage, itemsPerPage, totalCount, pageLength }: {
  currentPage: number;
  itemsPerPage: number;
  totalCount: number;
  pageLength: number;
}) => {
  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalCount);

  return (
    <div className="text-sm text-muted-foreground">
      {start === 1 && end === totalCount ? (
        `Showing ${pageLength} trade${pageLength !== 1 ? 's' : ''}`
      ) : (
        `Showing ${start} to ${end} of ${totalCount} trades`
      )}
    </div>
  );
};

const PaginationControls = ({
  currentPage,
  totalPages,
  loading,
  onPageChange
}: {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1 || loading}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
        {loading && <span className="ml-2 text-primary">Loading...</span>}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages || loading}
      >
        Next
      </Button>
    </div>
  );
};

// ============================================================================
// MAIN SWAP HISTORY COMPONENT
// History spans every pool type for the selected pair (each row tagged with
// its pool); prices are normalized to toAsset-per-fromAsset.
// ============================================================================
const SwapHistory: React.FC = () => {
  const { state } = useTradeForm();
  const { tokenIn, tokenOut } = state;
  const { userAddress } = useUser();

  const [currentPage, setCurrentPage] = useState(1);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [showMySwapsOnly, setShowMySwapsOnly] = useState(false);

  // new pair or filter -> back to the first page
  useEffect(() => {
    setCurrentPage(1);
  }, [tokenIn?.address, tokenOut?.address, showMySwapsOnly]);

  const historyQuery = useTradeHistory({
    tokenIn: tokenIn?.address,
    tokenOut: tokenOut?.address,
    page: currentPage,
    limit: ITEMS_PER_PAGE,
    sender: showMySwapsOnly && userAddress ? userAddress : undefined,
  });

  const hasPair = !!(tokenIn?.address && tokenOut?.address);
  const entries = historyQuery.data?.entries ?? [];
  const totalCount = historyQuery.data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  const loading = historyQuery.isFetching;
  const isInitialLoad = historyQuery.isLoading;
  const priceLabel = `${tokenOut?._symbol ?? ""}/${tokenIn?._symbol ?? ""}`;
  const columnCount = 8;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Trade history</h3>
        {userAddress && (
          <Button
            variant={showMySwapsOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMySwapsOnly(!showMySwapsOnly)}
            disabled={!hasPair || loading}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {showMySwapsOnly ? "Showing my trades" : "Show my trades"}
          </Button>
        )}
      </div>

      {hasPair ? (
        <div className="bg-card rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Time</TableHead>
                <TableHead className="w-[100px]">Token in</TableHead>
                <TableHead className="w-[120px]">Amount in</TableHead>
                <TableHead className="w-[100px]">Token out</TableHead>
                <TableHead className="w-[120px]">Amount out</TableHead>
                <TableHead className="w-[120px]">Price {priceLabel}</TableHead>
                <TableHead className="w-[80px]">Pool</TableHead>
                <TableHead className="w-[100px]">Sender</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={`transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {isInitialLoad ? (
                <LoadingRow colSpan={columnCount} />
              ) : entries.length > 0 ? (
                entries.map((swap) => (
                  <SwapRow
                    key={swap.id}
                    swap={swap}
                    copiedHash={copiedHash}
                    onCopy={copyToClipboard}
                  />
                ))
              ) : (
                <EmptyRow colSpan={columnCount} />
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <PaginationInfo
              currentPage={currentPage}
              itemsPerPage={ITEMS_PER_PAGE}
              totalCount={totalCount}
              pageLength={entries.length}
            />
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              loading={loading}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      ) : (
        <div className="bg-muted/50 rounded-lg p-6 text-center">
          <p className="text-muted-foreground">
            Select both tokens to view trade history
          </p>
        </div>
      )}
    </div>
  );
};

export default SwapHistory;

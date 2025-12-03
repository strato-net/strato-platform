import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Loader2 } from 'lucide-react';
import { useSwapContext } from '@/context/SwapContext';
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
const LoadingRow = () => (
  <TableRow>
    <TableCell colSpan={7} className="text-center py-8">
      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
    </TableCell>
  </TableRow>
);

const EmptyRow = () => (
  <TableRow>
    <TableCell colSpan={7} className="text-center py-8">
      <p className="text-muted-foreground">No swap history found for this pair</p>
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
            className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 active:bg-blue-100 dark:active:bg-blue-900/30 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
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

const SwapRow = ({ swap, copiedHash, onCopy }: { swap: any; copiedHash: string | null; onCopy: (text: string) => void }) => (
  <TableRow key={swap.id}>
    <TableCell className="text-sm">
      {formatTimestamp(swap.timestamp)}
    </TableCell>
    <TableCell className="font-medium text-sm">
      {swap.tokenIn}
    </TableCell>
    <TableCell className="text-sm">
      {formatWeiAmount(swap.amountIn)}
    </TableCell>
    <TableCell className="font-medium text-sm">
      {swap.tokenOut}
    </TableCell>
    <TableCell className="text-sm">
      {formatWeiAmount(swap.amountOut)}
    </TableCell>
    <TableCell className="text-sm">
      ${swap.impliedPrice}
    </TableCell>
    <SenderCell sender={swap.sender} copiedHash={copiedHash} onCopy={onCopy} />
  </TableRow>
);

const PaginationInfo = ({ currentPage, itemsPerPage, swapHistoryCount, swapHistoryLength }: {
  currentPage: number;
  itemsPerPage: number;
  swapHistoryCount: number;
  swapHistoryLength: number;
}) => {
  const totalPages = Math.ceil(swapHistoryCount / itemsPerPage);
  
  return (
    <div className="text-sm text-muted-foreground">
      {totalPages > 1 ? (
        `Showing ${currentPage * itemsPerPage + 1} to ${Math.min((currentPage + 1) * itemsPerPage, swapHistoryCount)} of ${swapHistoryCount} swaps`
      ) : (
        `Showing ${swapHistoryLength} swap${swapHistoryLength !== 1 ? 's' : ''}`
      )}
    </div>
  );
};

const PaginationControls = ({ 
  currentPage, 
  totalPages, 
  swapHistoryLoading, 
  onPageChange 
}: {
  currentPage: number;
  totalPages: number;
  swapHistoryLoading: boolean;
  onPageChange: (page: number) => void;
}) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(0, currentPage - 1))}
        disabled={currentPage === 0 || swapHistoryLoading}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {currentPage + 1} of {totalPages}
        {swapHistoryLoading && <span className="ml-2 text-blue-500">Loading...</span>}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
        disabled={currentPage === totalPages - 1 || swapHistoryLoading}
      >
        Next
      </Button>
    </div>
  );
};

// ============================================================================
// MAIN SWAP HISTORY COMPONENT
// ============================================================================
const SwapHistory: React.FC = () => {
  // ========================================================================
  // CONTEXT & HOOKS
  // ========================================================================
  const { refreshSwapHistory, pool, poolLoading, swapHistory, swapHistoryCount, swapHistoryLoading } = useSwapContext();
  const tableRef = useRef<HTMLDivElement>(null);

  // ========================================================================
  // STATE
  // ========================================================================
  const [currentPage, setCurrentPage] = useState(0);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================
  const totalPages = Math.ceil(swapHistoryCount / ITEMS_PER_PAGE);
  const shouldShowLoading = swapHistoryLoading || !pool?.address;

  // ========================================================================
  // EFFECTS
  // ========================================================================
  useEffect(() => {
    setCurrentPage(0);
    if (pool?.address) {
      refreshSwapHistory({
        limit: ITEMS_PER_PAGE.toString(),
        offset: "0",
      });
    }
  }, [pool?.address, refreshSwapHistory]);

  // ========================================================================
  // EVENT HANDLERS
  // ========================================================================
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (!pool?.address) return;
    
    setCurrentPage(newPage);
    refreshSwapHistory({
      limit: ITEMS_PER_PAGE.toString(),
      offset: (newPage * ITEMS_PER_PAGE).toString(),
    });
  };

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Swap History</h3>

      {pool?.address ? (
        <div ref={tableRef} className="bg-card rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Time</TableHead>
                <TableHead className="w-[100px]">Token In</TableHead>
                <TableHead className="w-[120px]">Amount In</TableHead>
                <TableHead className="w-[100px]">Token Out</TableHead>
                <TableHead className="w-[120px]">Amount Out</TableHead>
                <TableHead className="w-[120px]">Price {pool?.tokenB?._symbol}/{pool?.tokenA?._symbol}</TableHead>
                <TableHead className="w-[100px]">Sender</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shouldShowLoading ? (
                <LoadingRow />
              ) : swapHistory.length > 0 ? (
                swapHistory.map((swap) => (
                  <SwapRow 
                    key={swap.id} 
                    swap={swap} 
                    copiedHash={copiedHash} 
                    onCopy={copyToClipboard} 
                  />
                ))
              ) : (
                <EmptyRow />
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <PaginationInfo
              currentPage={currentPage}
              itemsPerPage={ITEMS_PER_PAGE}
              swapHistoryCount={swapHistoryCount}
              swapHistoryLength={swapHistory.length}
            />
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              swapHistoryLoading={swapHistoryLoading}
              onPageChange={handlePageChange}
            />
          </div>
        </div>
      ) : (
        <div className="bg-muted/50 rounded-lg p-6 text-center">
          <p className="text-muted-foreground">
            {poolLoading ? "Loading pool data..." : "Please select both token pairs to view swap history"}
          </p>
        </div>
      )}
    </div>
  );
};

export default SwapHistory;
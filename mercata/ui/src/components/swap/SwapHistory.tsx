import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Loader2 } from 'lucide-react';
import { useSwapContext } from '@/context/SwapContext';
import { useUser } from '@/context/UserContext';
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
  <TableCell className="font-mono text-[10px] md:text-xs">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onCopy(sender)}
            className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 active:bg-blue-100 dark:active:bg-blue-900/30 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
          >
            <span className="truncate max-w-[60px] md:max-w-none">
              {copiedHash === sender ? 'Copied!' : formatHash(sender)}
            </span>
            <Copy className="h-2.5 w-2.5 md:h-3 md:w-3 shrink-0" />
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
    <TableCell className="text-[10px] md:text-sm whitespace-nowrap">
      {formatTimestamp(swap.timestamp)}
    </TableCell>
    <TableCell className="font-medium text-[10px] md:text-sm">
      {swap.tokenIn}
    </TableCell>
    <TableCell className="text-[10px] md:text-sm">
      {formatWeiAmount(swap.amountIn)}
    </TableCell>
    <TableCell className="font-medium text-[10px] md:text-sm">
      {swap.tokenOut}
    </TableCell>
    <TableCell className="text-[10px] md:text-sm">
      {formatWeiAmount(swap.amountOut)}
    </TableCell>
    <TableCell className="text-[10px] md:text-sm">
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
  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, swapHistoryCount);
  
  return (
    <div className="text-xs md:text-sm text-muted-foreground">
      {start === 1 && end === swapHistoryCount ? (
        `${swapHistoryLength} swap${swapHistoryLength !== 1 ? 's' : ''}`
      ) : (
        `${start}-${end} of ${swapHistoryCount}`
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
    <div className="flex items-center gap-1.5 md:gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1 || swapHistoryLoading}
        className="h-7 md:h-8 px-2 md:px-3 text-xs"
      >
        <span className="hidden sm:inline">Previous</span>
        <span className="sm:hidden">Prev</span>
      </Button>
      <span className="text-xs md:text-sm text-muted-foreground whitespace-nowrap">
        {currentPage}/{totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage === totalPages || swapHistoryLoading}
        className="h-7 md:h-8 px-2 md:px-3 text-xs"
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
  const { userAddress } = useUser();
  const tableRef = useRef<HTMLDivElement>(null);

  // ========================================================================
  // STATE
  // ========================================================================
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [showMySwapsOnly, setShowMySwapsOnly] = useState(false);

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================
  const totalPages = Math.ceil(swapHistoryCount / ITEMS_PER_PAGE);
  const isInitialLoad = swapHistoryLoading && swapHistory.length === 0;

  // ========================================================================
  // EFFECTS
  // ========================================================================
  useEffect(() => {
    setCurrentPage(1);
    if (pool?.address) {
      refreshSwapHistory({
        limit: ITEMS_PER_PAGE.toString(),
        page: "1",
        ...(showMySwapsOnly && userAddress ? { sender: userAddress } : {}),
      });
    }
  }, [pool?.address, refreshSwapHistory, showMySwapsOnly, userAddress]);

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
      page: newPage.toString(),
      ...(showMySwapsOnly && userAddress ? { sender: userAddress } : {}),
    });
  };

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base md:text-lg font-semibold whitespace-nowrap">Swap History</h3>
        {userAddress && (
          <Button
            variant={showMySwapsOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMySwapsOnly(!showMySwapsOnly)}
            disabled={!pool?.address || swapHistoryLoading}
            className="text-xs md:text-sm h-8 px-2 md:px-3"
          >
            {swapHistoryLoading && <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin mr-1.5" />}
            <span className="hidden sm:inline">{showMySwapsOnly ? "Showing My Swaps" : "Show My Swaps"}</span>
            <span className="sm:hidden">{showMySwapsOnly ? "My Swaps" : "All"}</span>
          </Button>
        )}
      </div>

      {pool?.address ? (
        <div ref={tableRef} className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px] md:w-[140px] text-xs">Time</TableHead>
                  <TableHead className="w-[70px] md:w-[100px] text-xs">In</TableHead>
                  <TableHead className="w-[80px] md:w-[120px] text-xs">Amount</TableHead>
                  <TableHead className="w-[70px] md:w-[100px] text-xs">Out</TableHead>
                  <TableHead className="w-[80px] md:w-[120px] text-xs">Amount</TableHead>
                  <TableHead className="w-[80px] md:w-[120px] text-xs">Price</TableHead>
                  <TableHead className="w-[80px] md:w-[100px] text-xs">Sender</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={`transition-opacity duration-200 ${swapHistoryLoading ? "opacity-50 pointer-events-none" : ""}`}>
                {isInitialLoad ? (
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
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-3 md:px-6 py-3 md:py-4 border-t border-border">
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
        <div className="bg-muted/50 rounded-lg p-4 md:p-6 text-center">
          <p className="text-muted-foreground text-sm">
            {poolLoading ? "Loading pool data..." : "Select both token pairs to view swap history"}
          </p>
        </div>
      )}
    </div>
  );
};

export default SwapHistory;
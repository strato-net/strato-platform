import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Loader2 } from 'lucide-react';
import { useSwapContext } from '@/context/SwapContext';
import { formatWeiAmount, formatHash } from '@/utils/numberUtils';

const SwapHistory: React.FC = () => {
  const { refreshSwapHistory, fromAsset, toAsset, pool, swapHistory, swapHistoryCount, swapHistoryLoading, isTransitioning } = useSwapContext();
  const tableRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // State
  const itemsPerPage = 10;
  const [swapHistoryError, setSwapHistoryError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const totalPages = Math.ceil(swapHistoryCount / itemsPerPage);

  const shouldShowLoading = isTransitioning || swapHistoryLoading || (!!fromAsset?.address && !!toAsset?.address && !pool?.address);

   // Reset page when pool changes
  useEffect(() => {
    setCurrentPage(0);
  }, [pool?.address, fromAsset?.address, toAsset?.address]);

  // Fetch swap history when pool is available
  useEffect(() => {
    const fetchHistory = async () => {
      // Fetch if we have all required data (pool and assets)
      if (pool?.address && fromAsset?.address && toAsset?.address) {
        setSwapHistoryError(null);
        
        try {
          await refreshSwapHistory({
            limit: itemsPerPage.toString(),
            offset: (currentPage * itemsPerPage).toString(),
          });
        } catch (error) {
          console.error('Error refreshing swap history:', error);
          setSwapHistoryError('Failed to load swap history');
        }
      }
    };
    fetchHistory();
  }, [pool?.address, fromAsset?.address, toAsset?.address, currentPage, refreshSwapHistory]);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Swap History</h3>

      {fromAsset && toAsset ? (
        <div ref={tableRef} className="bg-white rounded-lg border">
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
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <p className="w-full flex justify-center items-center">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </p>
                  </TableCell>
                </TableRow>
              ) : swapHistoryError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <p className="text-red-500">{swapHistoryError}</p>
                  </TableCell>
                </TableRow>
              ) : swapHistory.length > 0 ? (
                  swapHistory.map((swap) => (
                    <TableRow key={swap.id}>
                      <TableCell className="text-sm">
                        {swap.timestamp.toLocaleDateString([], {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false
                        })}
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
                      <TableCell className="font-mono text-xs">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => copyToClipboard(swap.sender)}
                                className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
                              >
                                <span>
                                  {copiedHash === swap.sender ? 'Copied!' : formatHash(swap.sender)}
                                </span>
                                <Copy className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Click to copy full address</p>
                              <p className="font-mono text-xs break-all">{swap.sender}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
            ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <p className="text-gray-500">No swap history found for this pair</p>
                  </TableCell>
                </TableRow>
              )}
          </TableBody>
        </Table>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="text-sm text-gray-500">
              {totalPages > 1 ? (
                `Showing ${currentPage * itemsPerPage + 1} to ${Math.min((currentPage + 1) * itemsPerPage, swapHistoryCount)} of ${swapHistoryCount} swaps`
              ) : (
                `Showing ${swapHistory.length} swap${swapHistory.length !== 1 ? 's' : ''}`
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0 || shouldShowLoading}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {currentPage + 1} of {totalPages}
                  {shouldShowLoading && <span className="ml-2 text-blue-500">Loading...</span>}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage === totalPages - 1 || shouldShowLoading}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
    </div>
  ) : (
    <div className="bg-gray-50 rounded-lg p-6 text-center">
      <p className="text-gray-500">Please select both token pairs to view swap history</p>
    </div>
      )}
    </div>
  );
};

export default SwapHistory;
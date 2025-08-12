import { useState, useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, Copy, ExternalLink, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTransactionContext } from '@/context/TransactionContext';
import { formatHash } from '@/utils/numberUtils';

interface TransactionData {
  transaction_hash: string;
  block_timestamp: string;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

interface BridgeTransaction extends TransactionData {
  direction: 'in' | 'out';
}

const ITEMS_PER_PAGE = 10;

const BridgeHistory = () => {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    fetchDepositTransactions,
    fetchWithdrawTransactions
  } = useTransactionContext();

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHash(text);
      setTimeout(() => setCopiedHash(null), 1500);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  useEffect(() => {
    const loadTransactions = async () => {
      setLoading(true);
      try {
        // Fetch both deposit and withdrawal transactions
        const [depositResult, withdrawResult] = await Promise.all([
          fetchDepositTransactions({
            status: 'DepositInitiated',
            page: currentPage + 1,
            limit: Math.floor(ITEMS_PER_PAGE / 2)
          }),
          fetchWithdrawTransactions({
            status: 'WithdrawalInitiated',
            page: currentPage + 1,
            limit: Math.floor(ITEMS_PER_PAGE / 2)
          })
        ]);

        // Combine and sort transactions by timestamp
        const combined = [
          ...depositResult.data.map((tx: TransactionData) => ({ ...tx, direction: 'in' as const })),
          ...withdrawResult.data.map((tx: TransactionData) => ({ ...tx, direction: 'out' as const }))
        ].sort((a, b) => new Date(b.block_timestamp).getTime() - new Date(a.block_timestamp).getTime())
         .slice(0, ITEMS_PER_PAGE);

        setTransactions(combined);
        setTotalCount(depositResult.totalCount + withdrawResult.totalCount);
      } catch (error) {
        console.error('Error loading transactions:', error);
        setTransactions([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    };

    loadTransactions();
  }, [currentPage, fetchDepositTransactions, fetchWithdrawTransactions]);

  const getStatusBadge = (tx: BridgeTransaction) => {
    const status = tx.direction === 'in' ? tx.depositStatus : tx.withdrawalStatus;
    
    if (status === "1") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <Clock className="h-3 w-3 mr-1" />
          Initiated
        </span>
      );
    } else if (status === "2") {
      if (tx.direction === 'out') {
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
            <AlertCircle className="h-3 w-3 mr-1" />
            Approval Pending
          </span>
        );
      }
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </span>
      );
    } else if (status === "3") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
        <AlertCircle className="h-3 w-3 mr-1" />
        Unknown
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Bridge History</h3>

      <div className="bg-white rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Direction</TableHead>
              <TableHead className="w-[140px]">Time</TableHead>
              <TableHead className="w-[100px]">From</TableHead>
              <TableHead className="w-[100px]">To</TableHead>
              <TableHead className="w-[100px]">Token</TableHead>
              <TableHead className="w-[100px]">Amount</TableHead>
              <TableHead className="w-[120px]">Tx Hash</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <div className="flex justify-center items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
                  </div>
                </TableCell>
              </TableRow>
            ) : transactions.length > 0 ? (
              transactions.map((tx) => (
                <TableRow key={tx.transaction_hash}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {tx.direction === 'in' ? (
                        <>
                          <ArrowDownLeft className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium text-green-600">In</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpRight className="h-4 w-4 text-orange-600" />
                          <span className="text-sm font-medium text-orange-600">Out</span>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(tx.block_timestamp).toLocaleDateString([], {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => copyToClipboard(tx.from)}
                            className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
                          >
                            <span>
                              {copiedHash === tx.from ? 'Copied!' : formatHash(tx.from)}
                            </span>
                            <Copy className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Click to copy full address</p>
                          <p className="font-mono text-xs break-all">{tx.from}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {tx.direction === 'in' ? '(ETH)' : '(STRATO)'}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => copyToClipboard(tx.to)}
                            className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
                          >
                            <span>
                              {copiedHash === tx.to ? 'Copied!' : formatHash(tx.to)}
                            </span>
                            <Copy className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Click to copy full address</p>
                          <p className="font-mono text-xs break-all">{tx.to}</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {tx.direction === 'in' ? '(STRATO)' : '(ETH)'}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-sm">
                    {tx.direction === 'in' ? tx.tokenSymbol : tx.ethTokenSymbol}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {tx.amount}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {tx.txHash && (
                      <div className="flex items-center gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => copyToClipboard(tx.txHash!)}
                                className="flex items-center gap-1 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 active:scale-95 transition-all duration-150 rounded px-1 py-0.5"
                              >
                                <span>
                                  {copiedHash === tx.txHash ? 'Copied!' : formatHash(tx.txHash)}
                                </span>
                                <Copy className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Click to copy transaction hash</p>
                              <p className="font-mono text-xs break-all">{tx.txHash}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {tx.direction === 'in' && (
                          <a
                            href={`https://sepolia.etherscan.io/tx/${tx.txHash.startsWith('0x') ? tx.txHash : `0x${tx.txHash}`}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(tx)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  <p className="text-gray-500">No bridge transactions found</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Pagination Controls */}
        {totalPages > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="text-sm text-gray-500">
              {totalPages > 1 ? (
                `Showing ${currentPage * ITEMS_PER_PAGE + 1} to ${Math.min((currentPage + 1) * ITEMS_PER_PAGE, totalCount)} of ${totalCount} transactions`
              ) : (
                `Showing ${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0 || loading}
                >
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage === totalPages - 1 || loading}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BridgeHistory;
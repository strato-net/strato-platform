import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Clock, CheckCircle2, AlertCircle, ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { FrownOutlined } from '@ant-design/icons';

interface BridgeTransaction {
  transaction_hash: string;
  block_timestamp: string;
  from?: string;
  to?: string;
  ethRecipient?: string;
  amount: string;
  withdrawId?: string;
  ethTxHash?: string;
}

interface BridgeTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const BRIDGE_API_BASE_URL = import.meta.env.VITE_BRIDGE_API_BASE_URL;
const SAFE_ADDRESS = import.meta.env.VITE_SAFE_ADDRESS;

type TransactionType = 'WithdrawalInitiated' | 'DepositRecorded';

const ITEMS_PER_PAGE = 10;

const BridgeTransactionsModal = ({ isOpen, onClose }: BridgeTransactionsModalProps) => {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [transactionType, setTransactionType] = useState<TransactionType>('DepositRecorded');
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchBridgeTransactions = async () => {
      try {
        setIsLoading(true);
        const response = await axios.get(`${BRIDGE_API_BASE_URL}/api/safe/transaction/${transactionType.toLowerCase()}`);
        setTransactions(response.data.data || []);
        setCurrentPage(1);
      } catch (error) {
        // Handle error silently
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      fetchBridgeTransactions();
    }
  }, [isOpen, transactionType]);

  const formatAmount = (amount: string) => {
    const numAmount = Number(amount) / 1e18; // Convert from wei to ETH
    // Convert scientific notation to decimal format
    const decimalAmount = numAmount.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 20 });
    return `${decimalAmount} ETH`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getChainLabel = (address: string) => {
    return address.toLowerCase() === SAFE_ADDRESS?.toLowerCase() ? 'STRATO' : 'Ethereum';
  };

  const getFromChain = (tx: BridgeTransaction) => {
    if (transactionType === 'WithdrawalInitiated') {
      return 'STRATO';
    }
    return getChainLabel(tx.to || '');
  };

  const getToChain = (tx: BridgeTransaction) => {
    if (transactionType === 'WithdrawalInitiated') {
      return getChainLabel(tx.ethRecipient || '');
    }
    return 'STRATO';
  };

  const totalPages = Math.ceil(transactions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentTransactions = transactions.slice(startIndex, endIndex);

  const handlePendingClick = (tx: BridgeTransaction) => {
    console.log('Full Transaction Data:', tx);
  };

  return (
    <>
      <div className="container mx-auto py-8 px-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                <h1 className="text-2xl font-semibold text-gray-900">Bridge Transactions</h1>
              </div>
              <Tabs defaultValue="DepositRecorded" value={transactionType} onValueChange={(value) => setTransactionType(value as TransactionType)}>
                <TabsList className="grid w-[400px] grid-cols-2 bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm items-center">
                  <TabsTrigger 
                    value="DepositRecorded"
                    className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                  >
                    Deposit Recorded
                  </TabsTrigger>
                  <TabsTrigger 
                    value="WithdrawalInitiated"
                    className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                  >
                    Withdrawal Initiated
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80 border-b">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">#</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">From</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">To</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Amount</th>
                      {transactionType === 'WithdrawalInitiated' && (
                        <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Status</th>
                      )}
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading ? (
                      <tr>
                        <td colSpan={transactionType === 'WithdrawalInitiated' ? 6 : 5} className="py-8">
                          <div className="flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                            <span className="ml-2 text-gray-500">Loading transactions...</span>
                          </div>
                        </td>
                      </tr>
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan={transactionType === 'WithdrawalInitiated' ? 6 : 5} className="py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <FrownOutlined style={{ fontSize: 48, color: '#bdbdbd' }} />
                            <span className="text-lg font-semibold text-gray-400">Sorry, no data found</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      currentTransactions.map((tx, index) => (
                        <tr key={tx.transaction_hash} className="hover:bg-gray-50/50">
                          <td className="py-3 px-4 text-sm text-gray-500">{startIndex + index + 1}</td>
                          <td className="py-3 px-4 text-sm">{getFromChain(tx)}</td>
                          <td className="py-3 px-4 text-sm">{getToChain(tx)}</td>
                          <td className="py-3 px-4 text-sm font-medium">{formatAmount(tx.amount)}</td>
                          {transactionType === 'WithdrawalInitiated' && (
                            <td className="py-3 px-4">
                              <div 
                                className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors"
                                onClick={() => handlePendingClick(tx)}
                              >
                                <Clock className="h-4 w-4 text-yellow-500" />
                                <span className="text-sm">Pending</span>
                              </div>
                            </td>
                          )}
                          <td className="py-3 px-4 text-sm text-gray-500">{formatDate(tx.block_timestamp)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              {!isLoading && transactions.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50/80">
                  <div className="text-sm text-gray-500">
                    Showing {startIndex + 1} to {Math.min(endIndex, transactions.length)} of {transactions.length} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="hover:bg-blue-50"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-500">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="hover:bg-blue-50"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BridgeTransactionsModal; 
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

type TransactionType = 'DepositRecorded' | 'WithdrawalInitiated';
type WithdrawalStatus = 'WithdrawalInitiated' | 'WithdrawalPendingApproval' | 'WithdrawalCompleted';

const ITEMS_PER_PAGE = 10;

const BridgeTransactionsModal = ({ isOpen, onClose }: BridgeTransactionsModalProps) => {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [transactionType, setTransactionType] = useState<TransactionType>('DepositRecorded');
  const [withdrawalStatus, setWithdrawalStatus] = useState<WithdrawalStatus>('WithdrawalInitiated');
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const fetchBridgeTransactions = async () => {
      setIsLoading(true);
      const limit = ITEMS_PER_PAGE;
      const offset = (currentPage - 1) * ITEMS_PER_PAGE;
      let endpoint;
      if (transactionType === 'WithdrawalInitiated') {
        endpoint = withdrawalStatus.toLowerCase();
      } else {
        endpoint = transactionType.toLowerCase();
      }
      const response = await axios.get(`${BRIDGE_API_BASE_URL}/api/safe/transaction/${endpoint}`, {
        params: { limit, offset }
      });
      setTransactions(response.data.data || response.data || []);
      setIsLoading(false);
    };
    if (isOpen) fetchBridgeTransactions();
  }, [isOpen, transactionType, withdrawalStatus, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [transactionType, withdrawalStatus]);

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

  const currentTransactions = transactions;

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
              <Tabs defaultValue="DepositRecorded" value={transactionType} onValueChange={(value) => {
                setTransactionType(value as TransactionType);
                setCurrentPage(1);
              }}>
                <TabsList className="grid w-[400px] grid-cols-2 bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm items-center">
                  <TabsTrigger 
                    value="DepositRecorded"
                    className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                  >
                    Deposit 
                  </TabsTrigger>
                  <TabsTrigger 
                    value="WithdrawalInitiated"
                    className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                  >
                    Withdrawal 
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* New Withdrawal Status Tabs */}
            {transactionType === 'WithdrawalInitiated' && (
              <div className="mb-6">
                <Tabs defaultValue="WithdrawalInitiated" value={withdrawalStatus} onValueChange={(value) => {
                  setWithdrawalStatus(value as WithdrawalStatus);
                  setCurrentPage(1);
                }}>
                  <TabsList className="grid w-[600px] grid-cols-3 bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm items-center">
                    <TabsTrigger 
                      value="WithdrawalInitiated"
                      className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                    >
                      Withdrawal Initiated
                    </TabsTrigger>
                    <TabsTrigger 
                      value="WithdrawalPendingApproval"
                      className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                    >
                      Pending Approval
                    </TabsTrigger>
                    <TabsTrigger 
                      value="WithdrawalCompleted"
                      className="h-auto py-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg transition-all duration-200 hover:bg-gray-50/80 text-gray-600 font-medium text-center"
                    >
                      Completed
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}

            <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/80 border-b">
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">#</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">From</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">To</th>
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Amount</th>
                      {withdrawalStatus === 'WithdrawalPendingApproval' && (
                        <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Status</th>
                      )}
                      <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading ? (
                      <tr>
                        <td colSpan={(withdrawalStatus === 'WithdrawalInitiated' || withdrawalStatus === 'WithdrawalPendingApproval') ? 6 : 5} className="py-8">
                          <div className="flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                            <span className="ml-2 text-gray-500">Loading transactions...</span>
                          </div>
                        </td>
                      </tr>
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan={(withdrawalStatus === 'WithdrawalInitiated' || withdrawalStatus === 'WithdrawalPendingApproval') ? 6 : 5} className="py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <FrownOutlined style={{ fontSize: 48, color: '#bdbdbd' }} />
                            <span className="text-lg font-semibold text-gray-400">Sorry, no data found</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      currentTransactions.map((tx, index) => (
                        <tr key={tx.transaction_hash} className="hover:bg-gray-50/50">
                          <td className="py-3 px-4 text-sm text-gray-500">{(currentPage - 1) * ITEMS_PER_PAGE + index + 1}</td>
                          <td className="py-3 px-4 text-sm">{getFromChain(tx)}</td>
                          <td className="py-3 px-4 text-sm">{getToChain(tx)}</td>
                          <td className="py-3 px-4 text-sm font-medium">{formatAmount(tx.amount)}</td>
                          {withdrawalStatus === 'WithdrawalPendingApproval' && (
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
                    Showing {currentPage * ITEMS_PER_PAGE - ITEMS_PER_PAGE + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, transactions.length)} of {transactions.length} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-gray-500">
                      Page {currentPage}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => prev + 1)}
                      disabled={transactions.length < ITEMS_PER_PAGE}
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
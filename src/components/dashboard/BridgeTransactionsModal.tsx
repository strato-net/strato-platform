import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Clock, CheckCircle2, AlertCircle, ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { Tabs } from 'antd';
import 'antd/dist/reset.css';
import './BridgeTransactionsModal.css';
import { Button } from "@/components/ui/button";
import { FrownOutlined } from '@ant-design/icons';
import { formatDistanceToNow } from 'date-fns';

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
const SAFE_ADDRESS = import.meta.env.VITE_SAFE_ADDRESS;

type TransactionType = 'DepositRecorded' | 'WithdrawalInitiated';
type WithdrawalStatus = 'WithdrawalInitiated' | 'WithdrawalPendingApproval' | 'WithdrawalCompleted';
type DepositStatus = 'PendingDeposit' | 'ConfirmedDeposit';

const ITEMS_PER_PAGE = 10;

const BridgeTransactionsModal = ({ isOpen, onClose }: BridgeTransactionsModalProps) => {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [transactionType, setTransactionType] = useState<TransactionType>('DepositRecorded');
  const [withdrawalStatus, setWithdrawalStatus] = useState<WithdrawalStatus>('WithdrawalInitiated');
  const [depositStatus, setDepositStatus] = useState<DepositStatus>('PendingDeposit');
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const formatDate = (dateString: string) => {
    try {
      // Remove ' UTC' and add 'Z' to make it a valid ISO string
      const isoString = dateString.replace(' UTC', 'Z');
      const date = new Date(isoString);
      
      // Get relative time
      const relativeTime = formatDistanceToNow(date, { addSuffix: true });
      
      // If the time is more than 7 days ago, show the actual date
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      if (date < sevenDaysAgo) {
        // Convert to Indian time (UTC+5:30)
        const indianDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
        
        // Format the date
        return indianDate.toLocaleString('en-IN', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
      }
      
      return relativeTime;
    } catch (error) {
      console.error('Error formatting date:', error);
      return dateString;
    }
  };

  useEffect(() => {
    const fetchBridgeTransactions = async () => {
      setIsLoading(true);
      
      try {
        let response;
        if (transactionType === 'WithdrawalInitiated') {
          // For withdrawal transactions
          const endpoint = withdrawalStatus.toLowerCase();
          // response = await axios.get(`/api/withdrawalStatus/${endpoint}`);
          response = await axios.get(`/api/withdrawalStatus`);

          
          // Transform withdrawal data
          const withdrawalData = response.data?.data?.data || [];
          const transformedData = Array.isArray(withdrawalData) ? withdrawalData.map((item: any) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: 'STRATO',
            to: 'Ethereum',
            amount: '-',
            key: item.key
          })) : [];
          
          setTransactions(transformedData);
        } else {
          // For deposit transactions
          response = await axios.get(`/api/depositStatus`);
          
          // Access the nested data array
          const depositData = response.data?.data?.data || [];
          
          // Transform the data to match the expected format
          const transformedData = Array.isArray(depositData) ? depositData.map((item: any) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: 'Ethereum',
            to: 'STRATO',
            amount: '-',
            key: item.key
          })) : [];
          
          setTransactions(transformedData);
        }
      } catch (error) {
        console.error('Error fetching transactions:', error);
        setTransactions([]);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) fetchBridgeTransactions();
  }, [isOpen, transactionType, withdrawalStatus, depositStatus, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [transactionType, withdrawalStatus, depositStatus]);

  const formatAmount = (amount: string) => {
    const numAmount = Number(amount) / 1e18; // Convert from wei to ETH
    // Convert scientific notation to decimal format
    const decimalAmount = numAmount.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 20 });
    return `${decimalAmount} ETH`;
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

  // Calculate pagination
  const totalPages = Math.ceil(transactions.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentTransactions = transactions.slice(startIndex, endIndex);

  const handlePendingClick = (tx: BridgeTransaction) => {
    console.log('Full Transaction Data:', tx);
  };

  const depositItems = [
    {
      key: 'PendingDeposit',
      label: 'Initiated',
    },
    {
      key: 'ConfirmedDeposit',
      label: 'Confirme Deposit',
    },
  ];

  const withdrawalItems = [
    {
      key: 'WithdrawalInitiated',
      label: 'Withdrawal Initiated',
    },
    {
      key: 'WithdrawalPendingApproval',
      label: 'Pending Approval',
    },
    {
      key: 'WithdrawalCompleted',
      label: 'Completed',
    },
  ];

  const mainItems = [
    {
      key: 'DepositRecorded',
      label: 'Deposit',
    },
    {
      key: 'WithdrawalInitiated',
      label: 'Withdrawal',
    },
  ];

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
              <div className="w-[400px] bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm">
                <Tabs
                  activeKey={transactionType}
                  items={mainItems}
                  onChange={(value) => {
                    setTransactionType(value as TransactionType);
                    setCurrentPage(1);
                  }}
                  className="custom-tabs"
                  style={{
                    '--ant-primary-color': '#3b82f6',
                    '--ant-primary-color-hover': '#2563eb',
                  } as React.CSSProperties}
                />
              </div>
            </div>

            {transactionType === 'DepositRecorded' && (
              <div className="mb-6">
                <div className="w-[400px] bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm">
                  <Tabs
                    activeKey={depositStatus}
                    items={depositItems}
                    onChange={(value) => {
                      setDepositStatus(value as DepositStatus);
                      setCurrentPage(1);
                    }}
                    className="custom-tabs"
                    style={{
                      '--ant-primary-color': '#3b82f6',
                      '--ant-primary-color-hover': '#2563eb',
                    } as React.CSSProperties}
                  />
                </div>
              </div>
            )}

            {transactionType === 'WithdrawalInitiated' && (
              <div className="mb-6">
                <div className="w-[600px] bg-white/90 p-1.5 pb-4 rounded-xl border border-gray-200 shadow-sm">
                  <Tabs
                    activeKey={withdrawalStatus}
                    items={withdrawalItems}
                    onChange={(value) => {
                      setWithdrawalStatus(value as WithdrawalStatus);
                      setCurrentPage(1);
                    }}
                    className="custom-tabs"
                    style={{
                      '--ant-primary-color': '#3b82f6',
                      '--ant-primary-color-hover': '#2563eb',
                    } as React.CSSProperties}
                  />
                </div>
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
                        <td colSpan={5} className="py-8">
                          <div className="flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                            <span className="ml-2 text-gray-500">Loading transactions...</span>
                          </div>
                        </td>
                      </tr>
                    ) : !Array.isArray(transactions) || transactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-500">
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
                          <td className="py-3 px-4 text-sm">{tx.from}</td>
                          <td className="py-3 px-4 text-sm">{tx.to}</td>
                          <td className="py-3 px-4 text-sm font-medium">{tx.amount}</td>
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
                    Showing {startIndex + 1} to {Math.min(endIndex, transactions.length)} of {transactions.length} transactions
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
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
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
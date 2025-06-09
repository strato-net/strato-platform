import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Clock, CheckCircle2, AlertCircle, ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import axios from 'axios';
import { Tabs } from 'antd';
import 'antd/dist/reset.css';
import './BridgeTransactionsPage.css';
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
  txHash?: string;
  token?: string;
}

interface BridgeTransactionsPageProps {
  isOpen: boolean;
  onClose: () => void;
}
const SAFE_ADDRESS = import.meta.env.VITE_SAFE_ADDRESS;

type TransactionType = 'DepositRecorded' | 'WithdrawalInitiated';
type WithdrawalStatus = 'WithdrawalInitiated' | 'WithdrawalPendingApproval' | 'WithdrawalCompleted';
type DepositStatus = 'DepositInitiated' | 'DepositCompleted';

const ITEMS_PER_PAGE = 10;

const BridgeTransactionsPage = ({ isOpen, onClose }: BridgeTransactionsPageProps) => {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [transactionType, setTransactionType] = useState<TransactionType>('DepositRecorded');
  const [withdrawalStatus, setWithdrawalStatus] = useState<WithdrawalStatus>('WithdrawalInitiated');
  const [depositStatus, setDepositStatus] = useState<DepositStatus>('DepositInitiated');
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
          response = await axios.get(`/api/withdrawalStatus/${withdrawalStatus}`);

          
          // Transform withdrawal data
          const withdrawalData = response.data?.data?.data || [];
          const transformedData = Array.isArray(withdrawalData) ? withdrawalData.map((item: any) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: 'STRATO',
            to: 'Ethereum',
            amount: item.amount ? (Number(item.amount) / 1e18).toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 20 }) : '-',
            txHash: item.txHash,
            token: item.token,
            key: item.key
          })) : [];
          
          // Sort by timestamp in descending order (most recent first)
          transformedData.sort((a, b) => new Date(b.block_timestamp).getTime() - new Date(a.block_timestamp).getTime());
          setTransactions(transformedData);
        } else {
          // For deposit transactions
          response = await axios.get(`/api/depositStatus/${depositStatus}`);
          
          // Access the nested data array
          const depositData = response.data?.data?.data || [];
          
          // Transform the data to match the expected format
          const transformedData = Array.isArray(depositData) ? depositData.map((item: any) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: 'Ethereum',
            to: 'STRATO',
            amount: (Number(item.amount) / 1e18).toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 20 }),
            txHash: item.txHash,
            token: item.token,
            key: item.key
          })) : [];
          // Sort by timestamp in descending order (most recent first)
          transformedData.sort((a, b) => new Date(b.block_timestamp).getTime() - new Date(a.block_timestamp).getTime());
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
      key: 'DepositInitiated',
      label: 'Initiated',
    },
    {
      key: 'DepositCompleted',
      label: 'Completed',
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
              <div className="w-[400px] bg-white/90 p-1.5  rounded-xl border border-gray-200 shadow-sm">
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
                <div className="w-[400px] bg-white/90 p-1.5  rounded-xl border border-gray-200 shadow-sm">
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
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">To</th>
                      {((transactionType === 'DepositRecorded' && depositStatus === 'DepositInitiated') || 
                        (transactionType === 'WithdrawalInitiated' && withdrawalStatus === 'WithdrawalInitiated')) && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token Address</th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction Hash</th>
                      {transactionType === 'WithdrawalInitiated' && withdrawalStatus === 'WithdrawalPendingApproval' && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      )}
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
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
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.from}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.to}</td>
                          {((transactionType === 'DepositRecorded' && depositStatus === 'DepositInitiated') || 
                            (transactionType === 'WithdrawalInitiated' && withdrawalStatus === 'WithdrawalInitiated')) && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div className="group relative">
                                <span className="cursor-pointer">
                                  {tx.token ? `${tx.token.slice(0, 6)}...${tx.token.slice(-4)}` : '-'}
                                </span>
                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                                  {tx.token || '-'}
                                </div>
                              </div>
                            </td>
                          )}
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{tx.amount}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <div className="group relative">
                              <span className="cursor-pointer">
                                {tx.txHash ? `${tx.txHash.slice(0, 6)}...${tx.txHash.slice(-4)}` : '-'}
                              </span>
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10">
                                {tx.txHash || '-'}
                              </div>
                            </div>
                          </td>
                          {transactionType === 'WithdrawalInitiated' && withdrawalStatus === 'WithdrawalPendingApproval' && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <span 
                                onClick={() => handlePendingClick(tx)}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 cursor-pointer hover:bg-yellow-200 transition-colors"
                              >
                                <Clock className="h-3 w-3 mr-1" />
                                Pending Approval
                              </span>
                            </td>
                          )}
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(tx.block_timestamp)}
                          </td>
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

export default BridgeTransactionsPage; 
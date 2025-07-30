import React, { useState, Suspense } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import './BridgeTransactionsPage.css';
import { AntTabs, AntLoadingFallback } from '@/components/lazy/antd';
import { ComponentLoadingFallback } from '@/components/lazy/components';

// Lazy load transaction detail components
const DepositTransactionDetails = React.lazy(() => import('./DepositTransactionDetails'));
const WithdrawTransactionDetails = React.lazy(() => import('./WithdrawTransactionDetails'));

interface BridgeTransactionsPageProps {
  isOpen: boolean;
  onClose: () => void;
}

type TransactionType = 'DepositRecorded' | 'WithdrawalInitiated';

const BridgeTransactionsPage = ({ isOpen, onClose }: BridgeTransactionsPageProps) => {
  const [transactionType, setTransactionType] = useState<TransactionType>('DepositRecorded');

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
      <div className="container mx-auto max-w-full py-8 px-4">
        <div className="w-full overflow-x-hidden">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-4">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                  <h1 className="text-2xl font-semibold text-gray-900">Bridge Transactions</h1>
                </div>
                <div className="w-full sm:w-[400px] bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
                  <Suspense fallback={<AntLoadingFallback />}>
                    <AntTabs
                      activeKey={transactionType}
                      items={mainItems}
                      onChange={(value) => setTransactionType(value as TransactionType)}
                      className="custom-tabs"
                      style={{
                        '--ant-primary-color': '#3b82f6',
                        '--ant-primary-color-hover': '#2563eb',
                      } as React.CSSProperties}
                    />
                  </Suspense>
                </div>
              </div>

              <Suspense fallback={<ComponentLoadingFallback />}>
                {transactionType === 'DepositRecorded' ? (
                  <DepositTransactionDetails />
                ) : (
                  <WithdrawTransactionDetails />
                )}
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BridgeTransactionsPage; 
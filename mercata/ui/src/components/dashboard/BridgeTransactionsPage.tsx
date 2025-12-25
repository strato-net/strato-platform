import React, { useEffect, useState } from 'react';
import 'antd/dist/reset.css';
import './BridgeTransactionsPage.css';
import DepositTransactionDetails from './DepositTransactionDetails';
import WithdrawTransactionDetails from './WithdrawTransactionDetails';
import { useBridgeContext } from '@/context/BridgeContext';
import { BridgeTransactionTab } from '@mercata/shared-types';

const BridgeTransactionsPage = ({ isAdmin = false }: { isAdmin?: boolean }) => {
  const { loadNetworksAndTokens, targetTransactionTab, setTargetTransactionTab } = useBridgeContext();
  const [transactionType, setTransactionType] = useState<BridgeTransactionTab>('DepositRecorded');

  useEffect(() => {
    loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  // Check for target tab from context and set it
  useEffect(() => {
    if (targetTransactionTab) {
      setTransactionType(targetTransactionTab);
      // Clear the target tab after setting it
      setTargetTransactionTab(null);
    }
  }, [targetTransactionTab, setTargetTransactionTab]);

  return (
    <div className="w-full">
      <div className="bg-card rounded-xl shadow-sm border border-border">
        {/* Underline Tabs - same style as DepositsPage */}
        <div className="px-3 md:px-6 pt-3 md:pt-4">
          <div className="flex border-b border-border">
            <button
              onClick={() => setTransactionType('DepositRecorded')}
              className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                transactionType === 'DepositRecorded'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setTransactionType('WithdrawalInitiated')}
              className={`flex-1 py-2.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                transactionType === 'WithdrawalInitiated'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Withdrawal
            </button>
          </div>
        </div>

        {/* Content - edge to edge on mobile */}
        <div className="px-0 md:px-6 pb-0 md:pb-4 pt-3 md:pt-4">
          {transactionType === 'DepositRecorded' ? (
            <DepositTransactionDetails key="deposit" context={isAdmin ? 'admin' : undefined} />
          ) : (
            <WithdrawTransactionDetails key="withdrawal" context={isAdmin ? 'admin' : undefined} />
          )}
        </div>
      </div>
    </div>
  );
};

export default BridgeTransactionsPage; 
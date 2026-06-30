import React, { useEffect, useState } from 'react';
import { Tabs } from 'antd';
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
      <style>{`
        .custom-tabs .ant-tabs-tab {
          justify-content: center !important;
        }
        .custom-tabs .ant-tabs-tab-btn {
          justify-content: center !important;
          text-align: center !important;
          width: 100% !important;
          color: hsl(var(--muted-foreground)) !important;
        }
        .custom-tabs .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: hsl(var(--primary)) !important;
          text-shadow: none !important;
        }
        .custom-tabs .ant-tabs-ink-bar {
          background: hsl(var(--primary)) !important;
        }
      `}</style>
      <div className="w-full">
        <div className="bg-card rounded-xl shadow-sm p-3 md:p-4 border border-border">
          <div className="space-y-4">
            {/* Tabs */}
            <div className="w-full bg-muted/50 p-1 md:p-1.5 rounded-lg md:rounded-xl border border-border">
              <Tabs
                activeKey={transactionType}
                items={mainItems}
                onChange={(value) => setTransactionType(value as BridgeTransactionTab)}
                className="custom-tabs"
                style={{
                  '--ant-primary-color': 'hsl(var(--primary))',
                  '--ant-primary-color-hover': 'hsl(var(--primary))',
                } as React.CSSProperties}
              />
            </div>

            {/* Transaction Details */}
            <div className="overflow-x-auto">
              {transactionType === 'DepositRecorded' ? (
                <DepositTransactionDetails key="deposit" context={isAdmin ? 'admin' : undefined} />
              ) : (
                <WithdrawTransactionDetails key="withdrawal" context={isAdmin ? 'admin' : undefined} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BridgeTransactionsPage; 
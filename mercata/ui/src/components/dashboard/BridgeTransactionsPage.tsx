import React, { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
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
      <div className="container mx-auto max-w-full py-2 px-0">
        <div className="w-full overflow-x-hidden">
          <div className="bg-card rounded-2xl shadow-lg p-4 border border-border">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                  <h1 className="text-2xl font-semibold text-foreground">Bridge Transactions</h1>
                </div>
                <div className="w-full sm:w-[400px] bg-muted/50 p-1.5 rounded-xl border border-border shadow-sm">
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
              </div>

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
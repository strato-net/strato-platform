import React, { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Tabs } from 'antd';
import 'antd/dist/reset.css';
import './BridgeTransactionsPage.css';
import DepositTransactionDetails from './DepositTransactionDetails';
import WithdrawTransactionDetails from './WithdrawTransactionDetails';
import { useBridgeContext } from '@/context/BridgeContext';
import { BridgeTransactionTab } from '@mercata/shared-types';

const BridgeTransactionsPage = () => {
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
    {
      key: 'RedemptionInitiated',
      label: 'Redemption',
    },
    { key: 'USDSTDeposit',
      label: 'USDST',
    },
  ];

  return (
    <>
      <div className="container mx-auto max-w-full py-0 px-0 md:py-8 md:px-4">
        <div className="w-full overflow-x-hidden">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl shadow-lg p-4">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-[18px] md:mb-6">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="h-6 w-6 text-blue-600" />
                  <h1 className="text-2xl font-semibold text-gray-900">Bridge Transactions</h1>
                </div>
                <div className="w-full sm:w-[400px] bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm">
                  <Tabs
                    activeKey={transactionType}
                    items={mainItems}
                    onChange={(value) => setTransactionType(value as BridgeTransactionTab)}
                    className="custom-tabs"
                    style={{
                      '--ant-primary-color': '#3b82f6',
                      '--ant-primary-color-hover': '#2563eb',
                    } as React.CSSProperties}
                  />
                </div>
              </div>

              {transactionType === 'DepositRecorded' ? (
                <DepositTransactionDetails key="deposit" mintUSDST={false} />
              ):
              transactionType === 'WithdrawalInitiated' ? (
                <WithdrawTransactionDetails key="withdrawal" mintUSDST={false} />
              ):
              transactionType === 'RedemptionInitiated' ? (
                <WithdrawTransactionDetails key="redemption" mintUSDST={true} />
              ):
              transactionType === 'USDSTDeposit' ? (
                <DepositTransactionDetails key="usdst" mintUSDST={true} />
              ):
              // default to bridge out
              (
                <WithdrawTransactionDetails key="default" mintUSDST={false} />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default BridgeTransactionsPage; 
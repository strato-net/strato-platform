import React, { useState } from 'react';
import { DepositForm } from '@/components/dashboard/DepositModal';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';

const ExchangeCart = () => {
  const [tab, setTab] = useState<'buy' | 'bridge' | 'swap'>('buy');

  return (
    <div className="w-[600px] bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      {/* Toggle Buy/Bridge/Swap */}
      <div className="flex justify-between items-center">
        <div className="flex space-x-2">
          <button
            className={`px-4 py-1 rounded-full font-medium ${tab === 'buy' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
            onClick={() => setTab('buy')}
          >
            Buy
          </button>
          <button
            className={`px-4 py-1 rounded-full font-medium ${tab === 'bridge' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
            onClick={() => setTab('bridge')}
          >
            Bridge
          </button>
          <button
            className={`px-4 py-1 rounded-full font-medium ${tab === 'swap' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
            onClick={() => setTab('swap')}
          >
            Swap
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {tab === 'buy' ? (
        <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
          <DepositForm />
        </div>
      ) : tab === 'bridge' ? (
        <BridgeWidget />
      ) : (
        <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
          <SwapWidget />
        </div>
      )}
    </div>
  );
};

export default ExchangeCart; 
// components/TokenDropdown.tsx
import React, { useEffect, useState } from 'react';
import useDebouncedValue from '../_hooks/useDebounce';
import TokenIcon from '@/app/icons/TokenIcon';
import { Spin } from 'antd';
import { TokenData } from '@/interface/token';

interface Props {
  show: boolean;
  onClose: () => void;
  tokenSearchQuery: string;
  setTokenSearchQuery: (value: string) => void;
  popularTokens: TokenData[] | null;
  handleTokenSelect: (token: TokenData) => void;
}

const TokenDropdown: React.FC<Props> = ({
  show,
  onClose,
  tokenSearchQuery,
  setTokenSearchQuery,
  popularTokens,
  handleTokenSelect,
}) => {

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setTimeout(() => {
      setLoading(false)
    }, 500);
  }, [])
  
  const debouncedQuery = useDebouncedValue(tokenSearchQuery, 300);

  if (!show) return null;

  // Apply debounce to the search input

  // Filter tokens based on debounced search
  const filteredTokens = popularTokens
  ? popularTokens.filter((token) =>
      (token?._name || '').toLowerCase().includes(debouncedQuery.toLowerCase()) ||
      (token?._symbol || '').toLowerCase().includes(debouncedQuery.toLowerCase())
    )
  : [];

  console.log(filteredTokens, 'filteredTokens');

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-6 shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-medium">Select a token</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative mb-4">
          <input
            type="text"
            value={tokenSearchQuery}
            onChange={(e) => setTokenSearchQuery(e.target.value)}
            placeholder="Search tokens"
            className="w-full border border-blue-300 rounded-xl px-3 py-2 bg-blue-50 text-lg focus:outline-none text-[#2C3E50] placeholder-[#A0AEC0] bg-transparent"
          />
        </div>

        {/* Token List */}
        <div className="space-y-2">
          <div className="max-h-72 overflow-y-auto pr-1 space-y-2">
            {loading ? 
            <div className='min-h-72 flex justify-center items-center'>
              <Spin />
              </div>
             :
              filteredTokens.map((token) => (
                <button
                  key={`${token._symbol}-${token.address}`}
                  onClick={() => handleTokenSelect(token)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg"
                >
                  <TokenIcon symbol={token?._symbol || ''} size="lg" />
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{token._name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">{token._symbol}</span>
                      <span className="text-xs text-gray-400">{token.address}</span>
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TokenDropdown;

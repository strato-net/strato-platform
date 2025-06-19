"use client";

import TokenIcon from '@/app/icons/TokenIcon';
import TokenDropdown from '@/components/_dropdown/page';
import { useTokens } from '@/context/TokenContext';
import { TokenData } from '@/interface/token';
import Link from 'next/link';
import { useEffect, useState } from 'react';
export default function V4PositionCreate() {
  const { tokens } = useTokens()
  const [selectedToken1, setSelectedToken1] = useState<TokenData | null>(null);
  const [selectedToken2, setSelectedToken2] = useState<TokenData | null>(null);
    const [selectingToken, setSelectingToken] = useState<1 | 2 | null>(null);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [tokenSearchQuery, setTokenSearchQuery] = useState('');

     useEffect(() => {
        if (tokens && tokens.length > 0) {
          setSelectedToken1(tokens[0]);
        }
      }, [tokens]);
    
    const handleTokenSelect = (token: TokenData) => {
      if (selectingToken === 1) {
        setSelectedToken1(token);
      } else if (selectingToken === 2) {
        setSelectedToken2(token);
      }
      setShowTokenSelector(false);
      setSelectingToken(null);
    };

  return (
    <div className="w-full max-w-6xl mx-auto p-4">
      <nav aria-label="breadcrumb" className="text-sm mb-4">
        <Link href="/pool" className="text-blue-500 hover:underline">
          Your positions
        </Link>
        <span className="mx-2">/</span>
        <Link href="/pool/create/v4" className="text-blue-500 hover:underline">
          New position
        </Link>
      </nav>

      <div className="flex flex-col md:flex-row justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">New position</h1>
        <div className="flex gap-2 mt-4 md:mt-0">
          <button
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg cursor-not-allowed"
            disabled
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-neutral-400">
              <path d="M14.6667 8C14.6667 11.676 11.676 14.6667 8.00004 14.6667C5.45204 14.6667 3.16399 13.248 2.02999 10.9634C1.86599 10.6334 2.00077 10.2333 2.33077 10.07C2.65944 9.90532 3.06067 10.0413 3.224 10.3706C4.13133 12.1986 5.96137 13.334 8.00004 13.334C10.9407 13.334 13.3334 10.9413 13.3334 8.00065C13.3334 5.05998 10.9407 2.66732 8.00004 2.66732C6.07537 2.66732 4.33143 3.71065 3.39343 5.33398H5.33337C5.70204 5.33398 6.00004 5.63265 6.00004 6.00065C6.00004 6.36865 5.70204 6.66732 5.33337 6.66732H2.00004C1.63137 6.66732 1.33337 6.36865 1.33337 6.00065V2.66732C1.33337 2.29932 1.63137 2.00065 2.00004 2.00065C2.36871 2.00065 2.66671 2.29932 2.66671 2.66732V4.00602C3.90204 2.35736 5.86471 1.33398 8.00004 1.33398C11.676 1.33332 14.6667 4.324 14.6667 8Z" fill="currentColor" />
            </svg>
            Reset
          </button>
        </div>
      </div>

      <div className="sticky top-24 w-[100%] self-start flex justify-between">
        <div className="sticky top-24 w-[400px] self-start flex flex-col">
          <div className="w-full rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 bg-gray-900 text-white flex items-center justify-center rounded-full font-bold">1</div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-gray-500 font-semibold">Step 1</span>
                <span className="text-sm text-gray-900 font-semibold">Select token pair and fees</span>
              </div>
            </div>
            <div className="w-1 h-6 bg-gray-200 mx-auto my-4 rounded-full"></div>
            <div className="flex items-center gap-4">
              <div className="w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center rounded-full font-bold">2</div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-gray-400 font-semibold">Step 2</span>
                <span className="text-sm text-gray-500 font-semibold">Set price range and deposit amounts</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col flex-grow max-w-[660px] mb-8">
          <div className="w-full p-6 border rounded-2xl border-gray-200 flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold text-gray-900">Select pair</h2>
              <div className="flex flex-col md:flex-row gap-4">
                <button 
                 onClick={() => {
                  setShowTokenSelector(true);
                  setSelectingToken(1);
                }}
                className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full">
                  <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedToken1?._symbol || 'NA'} size="md" />
                    <span className="text-gray-800 font-medium">{selectedToken1 ? selectedToken1._name : 'ETH'}</span>
                  </div>
                  <svg className="w-5 h-5 rotate-90" fill="currentColor" viewBox="0 0 24 24"><path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" /></svg>
                </button>
                <button
                 onClick={() => {
                  setShowTokenSelector(true);
                  setSelectingToken(2);
                }}
                 className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-900 text-white w-full">
                  <span className="font-medium"> {selectedToken2 ? selectedToken2?._name : 'Choose token'}</span>
                  <svg className="w-5 h-5 rotate-90" fill="currentColor" viewBox="0 0 24 24"><path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" /></svg>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold text-gray-900">Fee tier</h2>
              <p className="text-sm text-gray-600">The amount earned providing liquidity. Choose an amount that suits your risk tolerance and strategy.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 border rounded-xl bg-white cursor-pointer">
                  <div className="font-semibold text-gray-800">0.01%</div>
                  <div className="text-xs text-gray-500">Best for very stable pairs.</div>
                  <div className="text-xs text-gray-400 mt-1">0 TVL</div>
                </div>
                <div className="p-4 border rounded-xl bg-white cursor-pointer">
                  <div className="font-semibold text-gray-800">0.05%</div>
                  <div className="text-xs text-gray-500">Best for stable pairs.</div>
                  <div className="text-xs text-gray-400 mt-1">0 TVL</div>
                </div>
                <div className="p-4 border-2 border-gray-900 rounded-xl bg-gray-100 cursor-pointer">
                  <div className="flex items-center gap-1 font-semibold text-gray-900">
                    0.3%
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.999 1.667a8.333 8.333 0 1 0 0 16.667A8.333 8.333 0 0 0 9.999 1.667zm3.359 6.833l-3.892 3.884a.417.417 0 0 1-.584 0l-1.942-1.942a.417.417 0 0 1 .583-.584l1.5 1.5 3.451-3.45a.417.417 0 0 1 .584.584z" /></svg>
                  </div>
                  <div className="text-xs text-gray-500">Best for most pairs.</div>
                  <div className="text-xs text-gray-400 mt-1">0 TVL</div>
                </div>
                <div className="p-4 border rounded-xl bg-white cursor-pointer">
                  <div className="font-semibold text-gray-800">1%</div>
                  <div className="text-xs text-gray-500">Best for exotic pairs.</div>
                  <div className="text-xs text-gray-400 mt-1">0 TVL</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10">
            <button
              className="w-full px-6 py-4 bg-gray-100 text-gray-500 font-semibold rounded-xl cursor-not-allowed"
              disabled
            >
              Continue
            </button>
          </div>
        </div>

      </div>

      {showTokenSelector && (
        <TokenDropdown
          show={showTokenSelector}
          onClose={() => setShowTokenSelector(false)}
          tokenSearchQuery={tokenSearchQuery}
          setTokenSearchQuery={setTokenSearchQuery}
          popularTokens={tokens}
          handleTokenSelect={handleTokenSelect}
        />
      )}

    </div>
  );
}

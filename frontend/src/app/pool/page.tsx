"use client";

import React from 'react';
import { useRouter } from 'next/navigation';

const positions = [
  { pool: 'WBTC/USDC', protocol: 'v3', fee: '0.30%', tvl: '$123.3M', apr: '46.616%', vol1D: '$52.5M', vol30D: '$866.3M', volRatio: '0.43' },
  { pool: 'USDC/ETH', protocol: 'v3', fee: '0.05%', tvl: '$108.8M', apr: '47.853%', vol1D: '$285.4M', vol30D: '$5.6B', volRatio: '2.62' },
  { pool: 'WISE/ETH', protocol: 'v2', fee: '0.30%', tvl: '$106.3M', apr: '0.002%', vol1D: '$1.6K', vol30D: '$117.8K', volRatio: '<0.01' },
  { pool: 'USDC/USD₮', protocol: 'v4', fee: '0.01%', tvl: '$103.1M', apr: '4.075%', vol1D: '$115.1M', vol30D: '$314.5M', volRatio: '1.12' },
  { pool: 'ETH/wstETH', protocol: 'v4', fee: '0.01%', tvl: '-', apr: '-', vol1D: '-', vol30D: '-', volRatio: '-' },
];

export const PositionsPage = () => {

  const router = useRouter();

  const handleClick = () => {
    router.push("/pool/create/v4");
  }

  return (
    <div className="bg-white min-h-screen p-6 text-gray-900">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-semibold mb-4">Your positions</h1>

        <div className="relative inline-flex items-center mb-4">
          <button onClick={() => handleClick()} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-l-xl transition duration-100 hover:opacity-80 active:opacity-60">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11H13V5C13 4.448 12.552 4 12 4C11.448 4 11 4.448 11 5V11H5C4.448 11 4 11.448 4 12C4 12.552 4.448 13 5 13H11V19C11 19.552 11.448 20 12 20C12.552 20 13 19.552 13 19V13H19C19.552 13 20 12.552 20 12C20 11.448 19.552 11 19 11Z" />
            </svg>
            <span className="font-semibold text-sm">New</span>
          </button>

          <div className="flex items-center justify-center bg-gray-800 rounded-r-xl p-2 cursor-pointer">
            <svg className="w-5 h-5 text-white transform rotate-270" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.7071 5.29289C16.0976 5.68342 16.0976 6.31658 15.7071 6.70711L10.4142 12L15.7071 17.2929C16.0976 17.6834 16.0976 18.3166 15.7071 18.7071C15.3166 19.0976 14.6834 19.0976 14.2929 18.7071L8.2929 12.7071C7.9024 12.3166 7.9024 11.6834 8.2929 11.2929L14.2929 5.29289C14.6834 4.90237 15.3166 4.90237 15.7071 5.29289Z" />
            </svg>
          </div>
        </div>

        <div className="mb-4 font-medium">Top pools by TVL</div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4">#</th>
                <th className="p-4">Pool</th>
                <th className="p-4">TVL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, idx) => (
                <tr key={idx} className="border-t border-gray-200 hover:bg-gray-50">
                  <td className="p-4">{idx + 1}</td>
                  <td className="p-4 font-medium">{pos.pool}</td>
                  <td className="p-4">{pos.tvl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-gray-600">Add liquidity to a pool and view your positions here.</p>
      </div>
    </div>
  );
}

export default PositionsPage;
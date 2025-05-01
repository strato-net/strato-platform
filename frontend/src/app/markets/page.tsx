"use client";

import React, { useRef, useState, useEffect } from 'react';
import { Card, Tabs, TabsProps } from 'antd';
import { motion } from 'framer-motion';

const poolData = [
  {
    pool: "WBTC/USDC",
    protocol: "v3",
    fee: "0.30%",
    tvl: "$127.6M",
    tvlNum: 127600000,
    apr: "13.564%",
    rewards: "+10.2%",
    vol1d: "$52.5M",
    vol30d: "$866.3M",
    ratio: "0.43",
  },
  {
    pool: "USDC/USDT",
    protocol: "v4",
    fee: "0.01%",
    tvl: "$116.4M",
    tvlNum: 116400000,
    apr: "1.799%",
    rewards: "+10.0%",
    vol1d: "$115.1M",
    vol30d: "$314.5M",
    ratio: "1.12",
  },
  {
    pool: "USDC/ETH",
    protocol: "v3",
    fee: "0.05%",
    tvl: "$110.1M",
    tvlNum: 110100000,
    apr: "16.273%",
    rewards: "+8.5%",
    vol1d: "$285.4M",
    vol30d: "$5.6B",
    ratio: "2.62",
  },
  {
    pool: "WISE/ETH",
    protocol: "v2",
    fee: "0.30%",
    tvl: "$107.0M",
    tvlNum: 107000000,
    apr: "0.003%",
    rewards: "-",
    vol1d: "$1.6K",
    vol30d: "$117.8K",
    ratio: "<0.01",
  },
  {
    pool: "ETH/wstETH",
    protocol: "v4",
    fee: "0.01%",
    tvl: "$90.4M",
    tvlNum: 90400000,
    apr: "0.187%",
    rewards: "-",
    vol1d: "-",
    vol30d: "-",
    ratio: "-",
  },
  {
    pool: "WBTC/ETH",
    protocol: "v3",
    fee: "0.30%",
    tvl: "$60.7M",
    tvlNum: 60700000,
    apr: "7.388%",
    rewards: "+7.0%",
    vol1d: "$10.2M",
    vol30d: "$200.1M",
    ratio: "0.05",
  },
];

export default function MarketsPage() {
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tvlSort, setTvlSort] = useState<'asc' | 'desc'>('desc');
  const [tooltip, setTooltip] = useState<{ text: string; left: number } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const sortedData = [...poolData].sort((a, b) =>
    tvlSort === 'asc' ? a.tvlNum - b.tvlNum : b.tvlNum - a.tvlNum
  );

  // useEffect(() => {
  //   async function fetchLpTokenData() {
  //     try {
  //       const response = await fetch('/api/lpToken');
  //       const data = await response.json();
  //       console.log('LP Token Data:', data);
  //     } catch (error) {
  //       console.error('Error fetching LP Token data:', error);
  //     }
  //   }
  //   fetchLpTokenData();
  // }, []);

  return (
    <motion.div
      className="w-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="w-full flex flex-col items-center">
        <div className="w-full max-w-[900px]">

          {/* <div className="border border-gray-200 rounded-xl p-6 mb-8 bg-white mt-8">
            <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome to your positions</h2>
            <p className="text-gray-400 text-base">Connect your wallet to view your current positions.</p>
          </div> */}

          <h2 className="text-2xl font-bold text-black mb-4 mt-8">Top pools by TVL</h2>

          <div ref={tableContainerRef} className="relative max-w-[900px] overflow-x-auto rounded-xl bg-white border border-gray-200" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {/* Tooltip outside table */}
            {tooltip && (
              <div
                className="pointer-events-none absolute z-50 px-3 py-2 rounded text-xs font-medium shadow-lg"
                style={{
                  left: tooltip.left,
                  top: -38,
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  color: '#6B7280', // Tailwind gray-400
                  background: 'none',
                  border: '1px solid #E5E7EB', // Tailwind gray-200
                }}
              >
                {tooltip.text}
              </div>
            )}
            <style>{`
              .hide-scrollbar::-webkit-scrollbar { display: none; }
            `}</style>
            <div
              className="hide-scrollbar"
              style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              ref={tableScrollRef}
            >
              <table className="min-w-[1200px] text-sm text-left">
                <thead>
                  <tr>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100 sticky left-0 z-20 w-12 min-w-[48px]">#</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100 sticky left-12 z-20 w-32 min-w-[128px]">Pool</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">Protocol</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">Fee tier</th>
                    <th className="px-4 py-3 font-semibold text-black bg-gray-100">
                      <span
                        className="relative group cursor-pointer flex items-center"
                        onClick={() => setTvlSort(tvlSort === 'asc' ? 'desc' : 'asc')}
                        onMouseEnter={e => {
                          if (tableContainerRef.current) {
                            const rect = tableContainerRef.current.getBoundingClientRect();
                            setTooltip({
                              text: 'Total Value Locked',
                              left: (e.target as HTMLElement).getBoundingClientRect().left - rect.left + ((e.target as HTMLElement).offsetWidth / 2),
                            });
                          }
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        TVL
                        <span className="ml-1 flex flex-col">
                          <svg className={`w-3 h-3 ${tvlSort === 'asc' ? 'text-gray-400' : 'text-gray-900'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                          </svg>
                          <svg className={`w-3 h-3 -mt-1 ${tvlSort === 'desc' ? 'text-gray-400' : 'text-gray-900'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </span>
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">
                      <span
                        className="relative group cursor-help"
                        onMouseEnter={e => {
                          if (tableContainerRef.current) {
                            const rect = tableContainerRef.current.getBoundingClientRect();
                            setTooltip({
                              text: 'Annualized based on 1 day fees',
                              left: (e.target as HTMLElement).getBoundingClientRect().left - rect.left + ((e.target as HTMLElement).offsetWidth / 2),
                            });
                          }
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        Pool APR
                      </span>
                    </th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">Rewards APR</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">1D Vol</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">30D Vol</th>
                    <th className="px-4 py-3 font-semibold text-gray-500 bg-gray-100">1Dvol/30Dvol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-black bg-gray-100 sticky left-0 z-10 w-12 min-w-[48px]">{idx + 1}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-gray-100 sticky left-12 z-10 w-32 min-w-[128px]">{row.pool}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.protocol}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.fee}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.tvl}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.apr}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.rewards}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.vol1d}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.vol30d}</td>
                      <td className="px-4 py-3 text-black font-semibold bg-white">{row.ratio}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => {
                if (tableScrollRef.current) {
                  tableScrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
                }
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-full shadow p-2 z-30"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              aria-label="Scroll right"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
} 
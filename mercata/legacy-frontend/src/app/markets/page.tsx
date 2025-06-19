"use client";

import React, { useRef, useState, useEffect } from 'react';
import { Spin } from 'antd';
import { motion } from 'framer-motion';
import axios from 'axios';
import { ethers } from 'ethers';
import { TokenData } from '@/interface/token';

export default function MarketsPage() {
  // const [tvlSort, setTvlSort] = useState<'asc' | 'desc'>('desc');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [tooltip, setTooltip] = useState<{ text: string; left: number } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [pools, setPools] = useState<TokenData[]>([]);
  // const [lpPools, setLpPools] = useState<any[]>([]);
  const [positionLoading, setPositionLoading] = useState(false);

  const fetchPools = async () => {
    try {
      setPositionLoading(true);
      const res = await axios.get("api/swap");
      // const lpres = await axios.get(`/api/lpToken/`);
      setPools(res.data);
      // setLpPools(lpres.data);
      setPositionLoading(false);
    } catch (err) {
      console.log(err);
      setPositionLoading(false);
    }
  };

  useEffect(() => {
    fetchPools();
  }, []);


  return (
    <motion.div
      className="w-full"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="w-full flex flex-col items-center">
        <div className="w-full max-w-[900px]">

          <h2 className="text-2xl font-bold text-black mb-4 mt-8">Top pools by TVL</h2>

          {positionLoading ? (
            <div className="h-40 w-full flex justify-between items-center">
              <Spin className="w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm mb-4">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-4 text-black">#</th>
                    <th className="p-4 text-black">Pool</th>
                    <th className="p-4 text-black">Overall TVL</th>
                    {/* <th className="p-4">My Position</th> */}
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool, idx) => (
                    <tr
                      key={idx}
                      className="border-t border-gray-200 hover:bg-gray-50"
                    >
                      <td className="p-4 text-black">{idx + 1}</td>
                      <td className="p-4 font-medium text-black">
                        {pool?.data?.tokenASymbol}/{pool?.data?.tokenBSymbol}
                      </td>
                      <td className="p-4 text-black">
                        ${(() => {
                          const priceA = BigInt(pool?.data?.tokenAPrice || 0);
                          const balA = BigInt(pool?.data?.tokenABalance || 0);
                          const priceB = BigInt(pool?.data?.tokenBPrice || 0);
                          const balB = BigInt(pool?.data?.tokenBBalance || 0);
                          const ONE = BigInt(10) ** BigInt(18);
                          const valueAW = (priceA * balA) / ONE;
                          const valueBW = (priceB * balB) / ONE;
                          const totalValueWei = valueAW + valueBW;
                          return parseFloat(ethers.formatUnits(totalValueWei, 18)).toFixed(2);
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div ref={tableContainerRef} className="relative max-w-[900px] overflow-x-auto rounded-xl bg-white " style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
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
          </div>
        </div>
      </div>
    </motion.div>
  );
} 
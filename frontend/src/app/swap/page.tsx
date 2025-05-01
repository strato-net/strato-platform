"use client";

import React, { FC, useEffect, useState } from "react";
import { Card, Tabs, TabsProps } from "antd";
import { motion } from "framer-motion";
import { Tabkey } from "@/interface/token";
import { RenderSwap } from "@/components/swapComp/page";
import { RenderLiquidity } from "@/components/liquidity/page";
import axios from "axios";
import { ethers } from "ethers";

const SwapPanel: FC = () => {
  const [activeTab, setActiveTab] = useState<Tabkey>("swap");
  const [showTable, setShowTable] = useState(true);
  const [pools, setPools] = useState<any[]>([]);
  const [lpPools, setLpPools] = useState<any[]>([]);

  // Get pools
  useEffect(() => {
    const fetchPools = async () => {
      try {
        const res = await axios.get("api/swap");
        const lpres = await axios.get(`/api/lpToken/`);
        setPools(res.data);
        setLpPools(lpres.data);
      } catch (err) {
        console.log(err);
      }
    };

    fetchPools();
  }, []);

  const tabItems: TabsProps["items"] = [
    {
      key: "swap",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Swap
        </span>
      ),
    },
    {
      key: "liquidity",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Liquidity
        </span>
      ),
    },
  ];

  return (
    <motion.div
      className="w-[100%]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card
        title={
          <div className="flex items-center justify-between p-2">
            <h1 className="text-2xl font-bold text-gray-800">
              Swap & Liquidity
            </h1>
          </div>
        }
        className="w-full rounded-2xl shadow-lg"
      >
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as Tabkey)}
          centered
          className="custom-tabs-vibrant"
        />
        <div
          className={`mt-4 mb-20 ${activeTab === "swap" ? "h-[440px]" : "h-auto"
            }`}
        >
          {activeTab === "swap" ? <RenderSwap /> : <RenderLiquidity />}
        </div>
        <div className="px-2 mb-4 font-medium flex items-center justify-between">
          <span>My positions</span>
          <button
            onClick={() => setShowTable(!showTable)}
            className="px-5 py-3 rounded-full cursor-pointer text-sm bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
          >
            {showTable ? "Hide Table" : "Show Table"}
          </button>
        </div>
        {showTable && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-4">#</th>
                  <th className="p-4">Pool</th>
                  <th className="p-4">TVL</th>
                  <th className="p-4">My Position</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-gray-200 hover:bg-gray-50"
                  >
                    <td className="p-4">{idx + 1}</td>
                    <td className="p-4 font-medium">
                      {pool.data.tokenASymbol}/{pool.data.tokenBSymbol}
                    </td>
                    <td className="p-4">
                      ${(() => {
                        const priceA = BigInt(pool.data.tokenAPrice);
                        const balA = BigInt(pool.data.tokenABalance);
                        const priceB = BigInt(pool.data.tokenBPrice);
                        const balB = BigInt(pool.data.tokenBBalance);
                        const ONE = BigInt(10) ** BigInt(18);
                        const valueAW = (priceA * balA) / ONE;
                        const valueBW = (priceB * balB) / ONE;
                        const totalValueWei = valueAW + valueBW;
                        return parseFloat(ethers.formatUnits(totalValueWei, 18)).toFixed(2);
                      })()}
                    </td>
                    <td className="p-4">
                      ${(() => {
                        const priceA = BigInt(pool.data.tokenAPrice);
                        const balA = BigInt(pool.data.tokenABalance);
                        const priceB = BigInt(pool.data.tokenBPrice);
                        const balB = BigInt(pool.data.tokenBBalance);
                        const ONE = BigInt(10) ** BigInt(18);
                        const valueAW = (priceA * balA) / ONE;
                        const valueBW = (priceB * balB) / ONE;
                        const totalValueWei = valueAW + valueBW;
                        const lpEntry = lpPools.find(lp => lp.address === pool.address);
                        const lpValue = lpEntry ? BigInt(lpEntry.value) : BigInt(0);
                        const userShareWei =
                          (totalValueWei * lpValue) / BigInt(pool._totalSupply);
                        return parseFloat(ethers.formatUnits(userShareWei, 18)).toFixed(2);
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </motion.div>
  );
};

const HomePage: React.FC = () => (
  <main className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 space-y-8">
    <SwapPanel></SwapPanel>
  </main>
);

export default HomePage;
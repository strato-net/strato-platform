"use client";

import React, { FC, useState } from "react";
import { Card, Tabs, TabsProps } from "antd";
import { motion } from "framer-motion";
import { Tabkey } from "@/interface/token";
import { RenderSwap } from "@/components/swapComp/page";
import { RenderLiquidity } from "@/components/liquidity/page";

const positions = [
  {
    pool: "WBTC/USDC",
    protocol: "v3",
    fee: "0.30%",
    tvl: "$123.3M",
    apr: "46.616%",
    vol1D: "$52.5M",
    vol30D: "$866.3M",
    volRatio: "0.43",
  },
  {
    pool: "USDC/ETH",
    protocol: "v3",
    fee: "0.05%",
    tvl: "$108.8M",
    apr: "47.853%",
    vol1D: "$285.4M",
    vol30D: "$5.6B",
    volRatio: "2.62",
  },
  {
    pool: "WISE/ETH",
    protocol: "v2",
    fee: "0.30%",
    tvl: "$106.3M",
    apr: "0.002%",
    vol1D: "$1.6K",
    vol30D: "$117.8K",
    volRatio: "<0.01",
  },
  {
    pool: "USDC/USD₮",
    protocol: "v4",
    fee: "0.01%",
    tvl: "$103.1M",
    apr: "4.075%",
    vol1D: "$115.1M",
    vol30D: "$314.5M",
    volRatio: "1.12",
  },
  {
    pool: "ETH/wstETH",
    protocol: "v4",
    fee: "0.01%",
    tvl: "-",
    apr: "-",
    vol1D: "-",
    vol30D: "-",
    volRatio: "-",
  },
];


const SwapPanel: FC = () => {
  const [activeTab, setActiveTab] = useState<Tabkey>("swap");

  const [showTable, setShowTable] = useState(true);

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
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-gray-200 hover:bg-gray-50"
                  >
                    <td className="p-4">{idx + 1}</td>
                    <td className="p-4 font-medium">{pos.pool}</td>
                    <td className="p-4">{pos.tvl}</td>
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

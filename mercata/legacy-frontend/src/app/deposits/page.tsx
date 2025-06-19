"use client";

import React, { FC, useCallback, useEffect, useState, useMemo, useRef } from "react";
import { Card, Tabs, TabsProps } from "antd";
import { motion } from "framer-motion";
import SupplyBorrowDashboard, { DashboardHandle } from "../_supplyTables/page";
import { TokenData } from "@/interface/token";
import { useTokens } from "@/context/TokenContext";
import axios from "axios";
import { RenderBorrowRepay } from "@/components/borrowRepay/page";
import { RenderLendDepositWithdraw } from "@/components/lendDepositWithdraw/page";

type TabKey = "deposits" | "borrow";

// Extend TokenData interface
interface ExtendedTokenData extends TokenData {
  collateralRatio?: string;
  interestRate?: string;
}

const DepositsPanel: FC = () => {
  const dashboardRef = useRef<DashboardHandle>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("deposits");
  const { tokens } = useTokens();

  const [tokenList, setTokenList] = useState<ExtendedTokenData[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lendingData, setLendingData] = useState<any>(null);

  const fetchLendingData = useCallback(async () => {
    try {
      const response = await fetch("/api/lend/");
      if (!response.ok) {
        throw new Error("Failed to fetch lending data");
      }
      const data = await response.json();
      setLendingData(data);
    } catch (error) {
      console.error("Error fetching lending data:", error);
    }
  }, []);

  console.log(lendingData, tokenList);

  useEffect(() => {
    const fetchTokenList = async () => {
      try {
        const userData = await JSON.parse(localStorage.getItem("user") || "{}");
        const res = await axios.get(
          `/api/tokens/table/balance?key=eq.${userData.userAddress}`
        );
        const responseAddresses = new Set(
          res.data.map((addr: { address: string }) =>
            addr?.address.toLowerCase()
          )
        );
        const filteredTokens = tokens
          ? tokens.filter((token) =>
            responseAddresses.has(token?.address?.toLowerCase())
          )
          : [];
        setTokenList(filteredTokens);
      } catch (err) {
        console.log(err);
      }
    };
    if (tokens) {
      fetchTokenList();
    }
  }, [tokens]);

  useEffect(() => {
    fetchLendingData();
  }, [fetchLendingData]);

  // Format tokens with lending data
  const formattedTokens = useMemo(() => {
    if (!tokens || !lendingData) return tokens;

    return tokens.map((token: TokenData): ExtendedTokenData => {
      const collateralRatio =
        token.address && lendingData?.assetCollateralRatio
          ? lendingData.assetCollateralRatio[token.address] || "0"
          : "0";
      const interestRate =
        token.address && lendingData?.assetInterestRate
          ? lendingData.assetInterestRate[token.address] || "0"
          : "0";

      return {
        ...token,
        collateralRatio,
        interestRate,
      };
    });
  }, [tokens, lendingData]);

  const tabItems: TabsProps["items"] = [
    {
      key: "deposits",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Deposit / Withdraw
        </span>
      ),
    },
    {
      key: "borrow",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Borrow / Repay
        </span>
      ),
    },
  ];

  console.log(formattedTokens, "formatted tokens");


  return (
    <motion.div
      className="w-[100%]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card title="" className="w-full rounded-2xl shadow-lg">
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          centered
          className="custom-tabs-vibrant"
        />
        <div className="mt-4 mb-10">
          {activeTab === "deposits" ? (
            <RenderLendDepositWithdraw dashboardRef={dashboardRef} />
          ) : (
            <RenderBorrowRepay dashboardRef={dashboardRef} />
          )}
        </div>
        <div className="h-auto mx-8 p-[4px] bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] rounded-xl flex justify-center">
          <div className="h-full w-full m-4 bg-white rounded-xl flex justify-between items-center">
            <SupplyBorrowDashboard ref={dashboardRef} />
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

export default DepositsPanel;

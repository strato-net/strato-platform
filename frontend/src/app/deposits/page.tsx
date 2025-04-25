"use client";

import React, { useState } from "react";
import {
  Card,
  InputNumber,
  Select,
  Button,
  Tabs,
  Radio,
  Table,
  message,
  TabsProps,
} from "antd";
import { motion, useTime } from "framer-motion";
const { Option } = Select;
const { TabPane } = Tabs;
import Link from "next/link";
import TokenDropdown from "@/components/_dropdown/page";
import SupplyBorrowDashboard from "../_supplyTables/page";
import { popularTokens } from "@/context/TokenContext";
import TokenIcon from "../icons/TokenIcon";

const depositsPanel: any = () => {
  const [activeTab, setActiveTab] = useState<"deposits" | "borrow">("deposits");

  const RenderDeposits = () => {
    const [showDepositTokenSelector, setShowDepositTokenSelector] = useState(false);
    const [selectedDepositToken, setSelectedDepositToken] = useState<any>(popularTokens[0]);
    const [depositAmount, setDepositAmount] = useState<number>(0);
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");


    const handleDeposits = () => {
      console.log("Token:", selectedDepositToken);
      console.log("Amount:", depositAmount);
      // You can replace this with actual logic later, like interacting with web3
    };

    const handleTokenSelect = (token: (typeof popularTokens)[0]) => {
      setSelectedDepositToken(token);
      setShowDepositTokenSelector(false);
    };

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">Deposit USDT</h2>

          <div className="mb-6 flex flex-col gap-2">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Select token
            </label>
            <button
              onClick={() => {
                setShowDepositTokenSelector(true);
              }}
              className="flex items-center justify-between px-4 py-3 border rounded-xl border-blue-200 bg-blue-50 w-full hover:bg-blue-100 transition"
            >
              <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedDepositToken?._symbol || 'NA'} size="md" />
                <span className="text-[#2C3E50] font-medium">
                  {selectedDepositToken._name ?? "ETH"}
                </span>
              </div>
              <svg
                className="w-5 h-5 rotate-90 text-blue-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Token
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(Number(e.target.value))}
                type="text"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">{selectedDepositToken?._symbol ?? 'ETH'}</h3>
              </div>
            </div>
          </div>
          <div className="mt-10 w-1/2 mx-auto">
            <button
              className={`w-full px-6 py-4 font-semibold rounded-xl transition bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white ${selectedDepositToken && depositAmount
                ? "cursor-pointer"
                : "cursor-not-allowed"
                }`}
              disabled={!(selectedDepositToken)}
              onClick={handleDeposits}
            >
              Deposits
            </button>
          </div>
        </div>
        {showDepositTokenSelector && (
          <TokenDropdown
            show={showDepositTokenSelector}
            onClose={() => setShowDepositTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={popularTokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    );
  };

  const RenderBorrow = () => {
    const [showWithdrawTokenSelector, setShowWithdrawTokenSelector] = useState(false);
    const [showColleteralTokenSelector, setShowColleteralTokenSelector] = useState(false);
    const [selectedWithdrawToken, setSelectedWithdrawToken] = useState<any | null>(popularTokens[0]);
    const [selectedColleteralToken, setSelectedColleteralToken] = useState<any | null>(popularTokens[0]);
    const [selectingToken, setSelectingToken] = useState<1 | 2 | null>(null);
    const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
    const [colleteralAmount, setColleteralAmount] = useState<number>(0)
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");

    const handleTokenSelect = (token: (typeof popularTokens)[0]) => {
      if (selectingToken === 1) {
        setSelectedWithdrawToken(token);
        setShowWithdrawTokenSelector(false);
      } else if (selectingToken === 2) {
        setSelectedColleteralToken(token);
        setShowColleteralTokenSelector(false);
      }
      setSelectingToken(null);
    };

    const handleWithdraw = () => {
      console.log("withdraw");

    }

    const isWithdrawFormValid = selectedWithdrawToken && selectedColleteralToken && withdrawAmount > 0 && colleteralAmount > 0
    console.log(isWithdrawFormValid, ">>");

    console.count("count")
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">Withdraw USDT</h2>

          <div className="mb-6 flex flex-col gap-2">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Select token
            </label>
            <button
              onClick={() => {
                setShowWithdrawTokenSelector(true);
                setSelectingToken(1);
              }}
              className="flex items-center justify-between px-4 py-3 border rounded-xl border-blue-200 bg-blue-50 w-full hover:bg-blue-100 transition"
            >
              <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedWithdrawToken?._symbol || 'NA'} size="md" />
                <span className="text-gray-800 font-medium">
                  {selectedWithdrawToken ? selectedWithdrawToken._name : "ETH"}
                </span>
              </div>
              <svg
                className="w-5 h-5 rotate-90 text-blue-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Token
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                type="text"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">{selectedWithdrawToken?._symbol ?? 'ETH'}</h3>
              </div>
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-2">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Select Colleteral
            </label>
            <button
              onClick={() => {
                setShowColleteralTokenSelector(true);
                setSelectingToken(2);
              }}
              className="flex items-center justify-between px-4 py-3 border rounded-xl border-blue-200 bg-blue-50 w-full hover:bg-blue-100 transition"
            >
              <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedColleteralToken?._symbol || ''} size="md" />
                <span className="text-gray-800 font-medium">
                  {selectedColleteralToken ? selectedColleteralToken._name : "ETH"}
                </span>
              </div>
              <svg
                className="w-5 h-5 rotate-90 text-blue-500"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
              </svg>
            </button>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Collateral Amount
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={colleteralAmount}
                onChange={(e) => setColleteralAmount(Number(e.target.value))}
                type="text"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">{selectedColleteralToken?._symbol ?? 'ETH'}</h3>
              </div>
            </div>
          </div>

          <div className="mb-2">
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={!isWithdrawFormValid}
              className={`w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 ${isWithdrawFormValid ? "cursor-pointer" : "cursor-not-allowed"}`}
            >
              Withdraw
            </button>
          </div>
        </div>
        {showWithdrawTokenSelector && (
          <TokenDropdown
            show={showWithdrawTokenSelector}
            onClose={() => setShowWithdrawTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={popularTokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
        {showColleteralTokenSelector && (
          <TokenDropdown
            show={showColleteralTokenSelector}
            onClose={() => setShowColleteralTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={popularTokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    );
  };

  const tabItems: TabsProps["items"] = [
    {
      key: "deposits",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Deposits
        </span>
      ),
    },
    {
      key: "borrow",
      label: (
        <span className="text-base font-semibold text-gray-700 transition-colors">
          Borrow
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
        title="Swap & Liquidity"
        className="w-full w-[100%] rounded-2xl shadow-lg"
      >
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(k) => setActiveTab((k as any))}
          centered
          className="custom-tabs-vibrant"
        />
        <div className="mt-4 mb-10">
          {activeTab === "deposits" ? <RenderDeposits /> : <RenderBorrow />}
        </div>
        <div className="h-auto mx-8 p-[4px] bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] rounded-xl flex justify-center">
          <div className="h-full w-full m-4 bg-white rounded-xl flex justify-between items-center">
            <SupplyBorrowDashboard />
          </div>
        </div>

      </Card>
    </motion.div>
  );
};

export default depositsPanel;

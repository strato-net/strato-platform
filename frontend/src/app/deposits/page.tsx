"use client";

import React, { FC, useEffect, useState } from "react";
import { Card, Tabs, TabsProps } from "antd";
import { motion } from "framer-motion";
import TokenDropdown from "@/components/_dropdown/page";
import SupplyBorrowDashboard from "../_supplyTables/page";
import TokenIcon from "../icons/TokenIcon";
import { TokenData } from "@/interface/token";
import { useTokens } from "@/context/TokenContext";
import axios from "axios";
import TabPane from "antd/es/tabs/TabPane";

type TabKey = "deposits" | "borrow";

const DepositsPanel: FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("deposits");
  const [activeTab2, setActiveTab2] = useState<"borrow" | "repay">("borrow");
  const [activeTab3, setActiveTab3] = useState<"deposit" | "withdraw">(
    "deposit"
  );
  const { tokens } = useTokens();

  const RenderDeposits: React.FC<RenderProps> = ({ tokens }) => {
    return (
      <div className="w-full">
        <Card className="w-full rounded-2xl shadow-lg">
          <Tabs
            activeKey={activeTab3}
            onChange={(k) => setActiveTab3(k as any)}
            centered
            className="custom-subTabs"
          >
            <TabPane tab="Deposit" key="deposit" />
            <TabPane tab="Withdraw" key="withdraw" />
          </Tabs>
          <motion.div
            className="mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab3 === "deposit" ? (
              <RenderDeposit tokens={tokens} />
            ) : (
              <RenderWithdraw />
            )}
          </motion.div>
        </Card>
      </div>
    );
  };

  const RenderDeposit: React.FC<RenderProps> = ({ tokens }) => {
    const [showDepositTokenSelector, setShowDepositTokenSelector] =
      useState(false);
    const [selectedDepositToken, setSelectedDepositToken] =
      useState<TokenData | null>(null);
    const [depositAmount, setDepositAmount] = useState<string>('');
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");

    const handleDepositAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setDepositAmount(value);
      }
    };

    const handleDeposit = () => {
      axios.post('/api/lend/manageLiquidity', {
        asset: selectedDepositToken?.address,
        amount: depositAmount,
        method: "depositLiquidity",      
      })
      .then((res) => {
        console.log(res);
      })
      .catch((err) => {
        console.log(err);
      });
    };

    useEffect(() => {
      if (tokens && tokens.length > 0) {
        setSelectedDepositToken(tokens[0]);
      }
    }, [tokens]);

    const handleTokenSelect = (token: TokenData) => {
      setSelectedDepositToken(token);
      setShowDepositTokenSelector(false);
    };

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
            Deposit
          </h2>

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
                <TokenIcon
                  symbol={selectedDepositToken?._symbol || "NA"}
                  size="md"
                />
                <span className="text-[#2C3E50] font-medium">
                  {selectedDepositToken?._name ?? "ETH"}
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
              Amount
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={depositAmount}
                onChange={handleDepositAmountChange}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedDepositToken?._symbol ?? "ETH"}
                </h3>
              </div>
            </div>
          </div>
          <div className="mt-10 w-1/2 mx-auto">
            <button
              className={`w-full px-6 py-4 font-semibold rounded-xl transition bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white ${
                selectedDepositToken && depositAmount
                  ? "cursor-pointer"
                  : "cursor-not-allowed"
              }`}
              disabled={!selectedDepositToken}
              onClick={handleDeposit}
            >
              Deposit
            </button>
          </div>
        </div>
        {showDepositTokenSelector && (
          <TokenDropdown
            show={showDepositTokenSelector}
            onClose={() => setShowDepositTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={tokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    );
  };

  const RenderWithdraw = () => {
    const [showDepositTokenSelector, setShowDepositTokenSelector] =
      useState(false);
    const [selectedDepositToken, setSelectedDepositToken] =
      useState<TokenData | null>(null);
    const [withdrawAmount, setWithdrawAmount] = useState<string>('');
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");

    const handleWithdrawAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setWithdrawAmount(value);
      }
    };

    const handleWithdraw = () => {
      axios.post('/api/lend/manageLiquidity', {
        asset: selectedDepositToken?.address,
        amount: withdrawAmount,
        method: "withdrawLiquidity",      
      })
      .then((res) => {
        console.log(res);
      })
      .catch((err) => {
        console.log(err);
      });
    };

    useEffect(() => {
      if (tokens && tokens.length > 0) {
        setSelectedDepositToken(tokens[0]);
      }
    }, [tokens]);

    const handleTokenSelect = (token: TokenData) => {
      setSelectedDepositToken(token);
      setShowDepositTokenSelector(false);
    };

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
            Withdraw
          </h2>

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
                <TokenIcon
                  symbol={selectedDepositToken?._symbol || "NA"}
                  size="md"
                />
                <span className="text-[#2C3E50] font-medium">
                  {selectedDepositToken?._name ?? "ETH"}
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
              Amount
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={withdrawAmount}
                onChange={handleWithdrawAmountChange}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedDepositToken?._symbol ?? "ETH"}
                </h3>
              </div>
            </div>
          </div>
          <div className="mt-10 w-1/2 mx-auto">
            <button
              className={`w-full px-6 py-4 font-semibold rounded-xl transition bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white ${
                selectedDepositToken && withdrawAmount
                  ? "cursor-pointer"
                  : "cursor-not-allowed"
              }`}
              disabled={!selectedDepositToken}
              onClick={handleWithdraw}
            >
              Withdraw
            </button>
          </div>
        </div>
        {showDepositTokenSelector && (
          <TokenDropdown
            show={showDepositTokenSelector}
            onClose={() => setShowDepositTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={tokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    );
  };

  const RenderBorrowRepay: React.FC<RenderProps> = ({ tokens }) => {
    return (
      <div className="w-full">
        <Card className="w-full rounded-2xl shadow-lg">
          <Tabs
            activeKey={activeTab2}
            onChange={(k) => setActiveTab2(k as any)}
            centered
            className="custom-subTabs"
          >
            <TabPane tab="Borrow" key="borrow" />
            <TabPane tab="Repay" key="repay" />
          </Tabs>
          <motion.div
            className="mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab2 === "borrow" ? (
              <RenderBorrow tokens={tokens} />
            ) : (
              <RenderRepay />
            )}
          </motion.div>
        </Card>
      </div>
    );
  };

  interface RenderProps {
    tokens: TokenData[] | null;
  }

  const RenderBorrow: React.FC<RenderProps> = ({ tokens }) => {
    const [showWithdrawTokenSelector, setShowWithdrawTokenSelector] =
      useState(false);
    const [showColleteralTokenSelector, setShowColleteralTokenSelector] =
      useState(false);
    const [selectedWithdrawToken, setSelectedWithdrawToken] =
      useState<TokenData | null>(null);
    const [selectedColleteralToken, setSelectedColleteralToken] =
      useState<TokenData | null>(null);
    const [selectingToken, setSelectingToken] = useState<1 | 2 | null>(null);
    const [withdrawAmount, setWithdrawAmount] = useState<string>('');
    const [colleteralAmount, setColleteralAmount] = useState<string>('');
    const [tokenSearchQueryWithdraw, setTokenSearchQueryWithdraw] =
      useState("");
    const [tokenSearchQueryColleteral, setTokenSearchQueryColleteral] =
      useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleWithdrawAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setWithdrawAmount(value);
      }
    };

    const handleColleteralAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setColleteralAmount(value);
      }
    };

    const borrowLoan = async () => {
      try {
        setIsLoading(true);
        const response = await axios.post("api/lend/getLoan", {
          asset: selectedWithdrawToken?.address,
          amount: withdrawAmount,
          collateralAsset: selectedColleteralToken?.address,
          collateralAmount: colleteralAmount,
        });
      } catch (error) {
        console.error("Error borrowing loan:", error);
      } finally {
        setIsLoading(false);
      }
    };

    const handleWithdraw = () => {
      if (isWithdrawFormValid) {
        borrowLoan();
      }
    };

    const isWithdrawFormValid =
      selectedWithdrawToken &&
      selectedColleteralToken &&
      parseFloat(withdrawAmount) > 0 &&
      parseFloat(colleteralAmount) > 0;

    useEffect(() => {
      if (tokens && tokens.length > 0) {
        setSelectedWithdrawToken(tokens[0]);
        setSelectedColleteralToken(tokens[0]);
      }
    }, [tokens]);

    const handleTokenSelect = (token: TokenData) => {
      if (selectingToken === 1) {
        setSelectedWithdrawToken(token);
        setShowWithdrawTokenSelector(false);
      } else if (selectingToken === 2) {
        setSelectedColleteralToken(token);
        setShowColleteralTokenSelector(false);
      }
      setSelectingToken(null);
    };

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
            Borrow Loan{" "}
          </h2>

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
                <TokenIcon
                  symbol={selectedWithdrawToken?._symbol || "NA"}
                  size="md"
                />
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
              Amount
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={withdrawAmount}
                onChange={handleWithdrawAmountChange}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedWithdrawToken?._symbol ?? "ETH"}
                </h3>
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
                <TokenIcon
                  symbol={selectedColleteralToken?._symbol || ""}
                  size="md"
                />
                <span className="text-gray-800 font-medium">
                  {selectedColleteralToken
                    ? selectedColleteralToken._name
                    : "ETH"}
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
                onChange={handleColleteralAmountChange}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedColleteralToken?._symbol ?? "ETH"}
                </h3>
              </div>
            </div>
          </div>

          <div className="mb-2">
            <button
              type="button"
              onClick={handleWithdraw}
              disabled={!isWithdrawFormValid || isLoading}
              className={`w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 ${
                isWithdrawFormValid && !isLoading
                  ? "cursor-pointer"
                  : "cursor-not-allowed"
              }`}
            >
              {isLoading ? "Borrowing..." : "Borrow"}
            </button>
          </div>
        </div>
        {showWithdrawTokenSelector && (
          <TokenDropdown
            show={showWithdrawTokenSelector}
            onClose={() => setShowWithdrawTokenSelector(false)}
            tokenSearchQuery={tokenSearchQueryWithdraw}
            setTokenSearchQuery={setTokenSearchQueryWithdraw}
            popularTokens={tokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
        {showColleteralTokenSelector && (
          <TokenDropdown
            show={showColleteralTokenSelector}
            onClose={() => setShowColleteralTokenSelector(false)}
            tokenSearchQuery={tokenSearchQueryColleteral}
            setTokenSearchQuery={setTokenSearchQueryColleteral}
            popularTokens={tokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    );
  };

  const RenderRepay = () => {
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
    const [loanId, setLoanId] = useState("");
    const [amount, setAmount] = useState<string>('');
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setAmount(value);
      }
    };

    const repayLoan = async () => {
      try {
        setIsLoading(true);
        const response = await axios.post("api/lend/repayLoan", {
          loanId,
          amount: amount,
          asset: selectedToken?.address,
        });
      } catch (error) {
        console.error("Error repaying loan:", error);
      } finally {
        setIsLoading(false);
      }
    };

    const handleRepay = () => {
      if (isFormValid) {
        repayLoan();
      }
    };

    const handleLoanIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*$/.test(value)) {
        setLoanId(value);
      }
    };

    const isFormValid = loanId && selectedToken && parseFloat(amount) > 0;

    useEffect(() => {
      if (tokens && tokens.length > 0) {
        setSelectedToken(tokens[0]);
      }
    }, []);

    const handleTokenSelect = (token: TokenData) => {
      setSelectedToken(token);
      setShowTokenSelector(false);
    };

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
            Repay Loan
          </h2>

          <div className="mb-6">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Loan ID
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={loanId}
                onChange={handleLoanIdChange}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Enter loan ID"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-2">
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Select Asset
            </label>
            <button
              onClick={() => {
                setShowTokenSelector(true);
              }}
              className="flex items-center justify-between px-4 py-3 border rounded-xl border-blue-200 bg-blue-50 w-full hover:bg-blue-100 transition"
            >
              <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedToken?._symbol || "NA"} size="md" />
                <span className="text-[#2C3E50] font-medium">
                  {selectedToken?._name || "ETH"}
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
              Amount
            </label>
            <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
              <input
                value={amount}
                onChange={handleAmountChange}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*\.?[0-9]*"
                placeholder="0.00"
                className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
              />
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedToken?._symbol ?? "ETH"}
                </h3>
              </div>
            </div>
          </div>

          <div className="mt-10 w-1/2 mx-auto">
            <button
              onClick={handleRepay}
              disabled={!isFormValid || isLoading}
              className={`w-full px-6 py-4 font-semibold rounded-xl transition bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white ${
                isFormValid && !isLoading
                  ? "cursor-pointer"
                  : "cursor-not-allowed"
              }`}
            >
              {isLoading ? "Repaying..." : "Repay"}
            </button>
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
  };

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
          onChange={(k) => setActiveTab(k as TabKey)}
          centered
          className="custom-tabs-vibrant"
        />
        <div className="mt-4 mb-10">
          {activeTab === "deposits" ? (
            <RenderDeposits tokens={tokens} />
          ) : (
            <RenderBorrowRepay tokens={tokens} />
          )}
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

export default DepositsPanel;

"use client";

import React, { FC, useCallback, useEffect, useState } from "react";
import { Card, notification, Spin, Tabs, TabsProps } from "antd";
import { Select } from "antd";
import { motion } from "framer-motion";
import TokenDropdown from "@/components/_dropdown/page";
import SupplyBorrowDashboard from "../_supplyTables/page";
import TokenIcon from "../icons/TokenIcon";
import { EnrichedLoan, LoanEntry, TokenData } from "@/interface/token";
import { useTokens } from "@/context/TokenContext";
import axios from "axios";
import { ethers } from "ethers";

type TabKey = "deposits" | "borrow";
type TabKey2 = "borrow" | "repay";
type TabKey3 = "deposit" | "withdraw";

const DepositsPanel: FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("deposits");
  const [activeTab2, setActiveTab2] = useState<TabKey2>("borrow");
  const [activeTab3, setActiveTab3] = useState<TabKey3>("deposit");
  const { tokens } = useTokens();

  const [tokenList, setTokenList] = useState<TokenData[]>([]);

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

  const RenderDeposits: React.FC<RenderProps> = () => {
    const tabItems: TabsProps["items"] = [
      {
        key: "deposit",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Deposits
          </span>
        ),
      },
      {
        key: "withdraw",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Withdraw
          </span>
        ),
      },
    ];
    return (
      <div className="w-full">
        <Card className="w-full rounded-2xl shadow-lg">
          <Tabs
            items={tabItems}
            activeKey={activeTab3}
            onChange={(k) => setActiveTab3(k as TabKey3)}
            centered
            className="custom-tabs-vibrant"
          />
          <motion.div
            className="mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab3 === "deposit" ? (
              <RenderDeposit tokens={tokenList} />
            ) : (
              <RenderWithdraw tokens={tokenList} />
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
    const [depositAmount, setDepositAmount] = useState<string>("");
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [depositLoading, setDepositLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();

    const handleDepositAmountChange = (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setDepositAmount(value);
      }
    };

    const handleDeposit = async () => {
      try {
        setDepositLoading(true);
        // Convert depositAmount (a decimal string) to a BigInt in wei
        const decimals = 18;
        const [whole, fraction = ""] = depositAmount.split(".");
        const fractionPadded = (fraction + "0".repeat(decimals)).slice(
          0,
          decimals
        );
        const amountInWei = BigInt(whole + fractionPadded).toString();
        const res = await axios.post("/api/lend/manageLiquidity", {
          asset: selectedDepositToken?.address,
          amount: amountInWei,
          method: "depositLiquidity",
        });
        console.log(res);
        setDepositLoading(false);
        api["success"]({
          message: "Success",
          description: `Successfully deposited ${depositAmount} ${selectedDepositToken?._symbol}`,
        });
      } catch (err) {
        console.log(err);
        setDepositLoading(false);
        api["error"]({
          message: "Error",
          description: `Deposit Error - ${err}`,
        });
      }
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
              className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition ${selectedDepositToken && depositAmount
                ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
                : "cursor-not-allowed bg-gray-300"
                }`}
              disabled={!selectedDepositToken || depositLoading}
              onClick={handleDeposit}
            >
              {depositLoading && <Spin />}
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
        {contextHolder}
      </div>
    );
  };

  const RenderWithdraw: React.FC<RenderProps> = ({ tokens }) => {
    const [showDepositTokenSelector, setShowDepositTokenSelector] =
      useState(false);
    const [selectedDepositToken, setSelectedDepositToken] =
      useState<TokenData | null>(null);
    const [withdrawAmount, setWithdrawAmount] = useState<string>("");
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();

    const handleWithdrawAmountChange = (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setWithdrawAmount(value);
      }
    };

    const handleWithdraw = async () => {
      try {
        setWithdrawLoading(true);
        // Use ethers.js to parse the decimal string to wei
        const amountInWei = ethers.parseUnits(withdrawAmount, 18).toString();
        const res = await axios.post("/api/lend/manageLiquidity", {
          asset: selectedDepositToken?.address,
          amount: amountInWei,
          method: "withdrawLiquidity",
        });
        console.log(res);
        setWithdrawLoading(false);
        api["success"]({
          message: "Success",
          description: `Successfully withdraw ${withdrawAmount} ${selectedDepositToken?._symbol}`,
        });
      } catch (err) {
        console.error(err);
        setWithdrawLoading(false);
        api["error"]({
          message: "Error",
          description: `Withdraw Error - ${err}`,
        });
      }
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
              className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition ${selectedDepositToken && withdrawAmount
                ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
                : "cursor-not-allowed bg-gray-300"
                }`}
              disabled={!selectedDepositToken || withdrawLoading}
              onClick={handleWithdraw}
            >
              {withdrawLoading && <Spin />}
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
        {contextHolder}
      </div>
    );
  };

  const RenderBorrowRepay: React.FC<RenderProps> = ({ tokens }) => {
    const tabItems: TabsProps["items"] = [
      {
        key: "borrow",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Borrow
          </span>
        ),
      },
      {
        key: "repay",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Repay
          </span>
        ),
      },
    ];
    return (
      <div className="w-full">
        <Card className="w-full rounded-2xl shadow-lg">
          <Tabs
            items={tabItems}
            activeKey={activeTab2}
            onChange={(k) => setActiveTab2(k as TabKey2)}
            centered
            className="custom-tabs-vibrant"
          />
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
    const [withdrawAmount, setWithdrawAmount] = useState<string>("");
    const [colleteralAmount, setColleteralAmount] = useState<string>("");
    const [tokenSearchQueryWithdraw, setTokenSearchQueryWithdraw] =
      useState("");
    const [tokenSearchQueryColleteral, setTokenSearchQueryColleteral] =
      useState("");
    const [borrowLoading, setBorrowLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();

    const handleWithdrawAmountChange = (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setWithdrawAmount(value);
      }
    };

    const handleColleteralAmountChange = (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setColleteralAmount(value);
      }
    };

    const borrowLoan = async () => {
      try {
        setBorrowLoading(true);
        // Use ethers.js to parse amounts to wei
        const amountInWei = ethers.parseUnits(withdrawAmount, 18).toString();
        const collateralInWei = ethers
          .parseUnits(colleteralAmount, 18)
          .toString();
        const response = await axios.post("api/lend/getLoan", {
          asset: selectedWithdrawToken?.address,
          amount: amountInWei,
          collateralAsset: selectedColleteralToken?.address,
          collateralAmount: collateralInWei,
        });
        console.log(response, "<<");
        setBorrowLoading(false);
        api["success"]({
          message: "Success",
          description: `Successfully Borrowed ${withdrawAmount} ${selectedWithdrawToken?._symbol}`,
        });
      } catch (error) {
        setBorrowLoading(false);
        console.error("Error borrowing loan:", error);
        api["error"]({
          message: "Error",
          description: `Borrow Error - ${error}`,
        });
      } finally {
        setBorrowLoading(false);
      }
    };

    const handleBorrow = () => {
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
              Select Collateral
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
              onClick={handleBorrow}
              disabled={!isWithdrawFormValid || borrowLoading}
              className={`flex justify-center gap-3 w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 ${isWithdrawFormValid && !borrowLoading
                ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
                : "cursor-not-allowed bg-gray-300"
                }`}
            >
              {borrowLoading && <Spin />}
              {borrowLoading ? "Borrowing..." : "Borrow"}
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
        {contextHolder}
      </div>
    );
  };

  const RenderRepay = () => {
    const [loanList, setLoanList] = useState<EnrichedLoan[]>([]);
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
    const [loan, setLoan] = useState<LoanEntry | null>(null);
    const [amount, setAmount] = useState<string>("");
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [repayLoading, setRepayLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();

    // Load user address and fetch their loans with token metadata
    const fetchLoans = useCallback(async () => {
      const userData = JSON.parse(localStorage.getItem("user") || "{}");
      const addr = userData.userAddress;
      try {
        const resp = await axios.get("/api/lend");
        const pool = resp.data;
        const loansObj = pool.loans || {};
        const userLoans = Object.entries(loansObj)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map(([loanId, loan]: [string, any]) => ({ loanId, ...loan }))
          .filter((loan: LoanEntry) => loan.user === addr && loan.active === true);
        console.log(userLoans, "user loans");
        const enrichedLoans = await Promise.all(
          userLoans.map(async (loan: LoanEntry) => {
            const tokenResp = await axios.get(`/api/tokens/${loan.asset}`);
            const { _symbol, _name } = tokenResp.data[0];
            const balanceHuman = ethers.formatUnits(loan.amount, 18);
            return { ...loan, _symbol, _name, balanceHuman };
          })
        );
        setLoanList(enrichedLoans);
        if (enrichedLoans.length > 0) {
          setLoan(enrichedLoans[0]);
        }
      } catch (e) {
        console.error("Error fetching loans:", e);
      }
    }, []);

    useEffect(() => {
      fetchLoans();
    }, [fetchLoans]);

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (/^\d*\.?\d*$/.test(value)) {
        setAmount(value);
      }
    };

    const repayLoan = async () => {
      try {
        setRepayLoading(true);
        const amountInWei = ethers.parseUnits(amount, 18).toString();
        const response = await axios.post("api/lend/repayLoan", {
          loanId: loan?.loanId,
          amount: amountInWei,
          asset: loan?.asset,
        });
        console.log(response, "repay loan response");
        await fetchLoans();
        setRepayLoading(false);
        api["success"]({
          message: "Success",
          description: `Successfully Repaid ${amount} ${loan?._symbol}`,
        });
      } catch (error) {
        api["error"]({
          message: "Error",
          description: `Repay Error - ${error}`,
        });
        setRepayLoading(false);
        console.error("Error repaying loan:", error);
      } finally {
        setAmount("");
        setRepayLoading(false);
      }
    };

    const handleRepay = () => {
      if (isFormValid) {
        repayLoan();
      }
    };

    const isFormValid =
      !!loan?.loanId && !!selectedToken && parseFloat(amount) > 0;

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
              Select Loan
            </label>
            <Select
              value={loan?.loanId}
              onChange={(value: string) => {
                const selected = loanList.find((l) => l.loanId === value);
                setLoan(selected || null);
              }}
              options={loanList.map((loan) => ({
                label: `${loan._symbol} - ${loan.balanceHuman}`,
                value: loan.loanId,
              }))}
              placeholder="Select a loan"
              className="w-full"
            />
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
                  {loan?._symbol ?? "ETH"}
                </h3>
              </div>
            </div>
          </div>

          <div className="mt-10 w-1/2 mx-auto">
            <button
              onClick={handleRepay}
              disabled={!isFormValid || repayLoading}
              className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition ${isFormValid && !repayLoading
                ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
                : "cursor-not-allowed bg-gray-300"
                }`}
            >
              {repayLoading && <Spin />}
              {repayLoading ? "Repaying..." : "Repay"}
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
        {contextHolder}
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
      <Card title="" className="w-full w-[100%] rounded-2xl shadow-lg">
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
          centered
          className="custom-tabs-vibrant"
        />
        <div className="mt-4 mb-10">
          {activeTab === "deposits" ? (
            <RenderDeposits tokens={tokenList} />
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

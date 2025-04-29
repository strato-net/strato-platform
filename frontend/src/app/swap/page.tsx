"use client";

import React, { FC, useEffect, useState } from "react";
import { Card, notification, Spin, Tabs, TabsProps } from "antd";
import { motion } from "framer-motion";
import BigNumber from "bignumber.js";
import TokenDropdown from "@/components/_dropdown/page";
import TokenIcon from "../icons/TokenIcon";
import { Tabkey, TabKey2, TokenData } from "@/interface/token";
import axios from "axios";
import { useUser } from "@/context/UserContext";
// import { popularTokens } from "@/components/_dropdown/page";

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
  const [activeTab2, setActiveTab2] = useState<TabKey2>("deposits");

  const RenderSwap = () => {
    const [tokenSearchQuerySell, setTokenSearchQuerySell] = useState("");
    const [tokenSearchQueryBuy, setTokenSearchQueryBuy] = useState("");
    const [showTokenSelectorSell, setShowTokenSelectorSell] = useState(false);
    const [showTokenSelectorBuy, setShowTokenSelectorBuy] = useState(false);
    const [selectedSellToken, setSelectedSellToken] =
      useState<TokenData | null>(null);
    const [selectedBuyToken, setSelectedBuyToken] = useState<TokenData | null>(
      null
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pool, setPool] = useState<any>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [slippage, setSlippage] = useState("0.5");
    const [sellAmount, setSellAmount] = useState("");
    const [buyAmount, setBuyAmount] = useState("");

    const [tokenList, setTokenList] = useState<TokenData[]>([]);

    const [tokenList2, setTokenList2] = useState<TokenData[]>([]);

    const [selectedToken1Amount, setSelectedToken1Amount] = useState(0);
    const [swapLoading, setSwapLoading] = useState(false)
    const [api, contextHolder] = notification.useNotification();
    const { userAddress } = useUser();


    useEffect(() => {
      const fetchTokens = async () => {
        try {
          const res = await axios.get("api/swapableTokens");
          setTokenList(res.data);
        } catch (err) {
          console.log(err);
        }
      };
      const fetchPools = async () => {
        try {
          const res = await axios.get("api/swap");
          setPool(res.data);
        } catch (err) {
          console.log(err);
        }
      };

      fetchTokens();
      fetchPools();
    }, []);

    useEffect(() => {
      if (
        selectedSellToken &&
        selectedSellToken.address &&
        selectedBuyToken &&
        selectedBuyToken.address
      ) {
        getPoolByTokenPair(selectedSellToken.address, selectedBuyToken.address);
      }
    }, [selectedSellToken, selectedBuyToken]);

    const handleSwapTokenSelectSell = (token: TokenData) => {
      if (token._symbol === selectedBuyToken?._symbol) {
        setSelectedBuyToken(selectedSellToken);
        setSelectedSellToken(token);
      } else {
        setSelectedSellToken(token);
      }
      getPairedSwapableTokens(token?.address || "");
      getTokenBalance(token?.address || "");
      setShowTokenSelectorSell(false);
      setSellAmount("");
      setBuyAmount("");
    };

    const handleSwapTokenSelectBuy = (token: TokenData) => {
      if (token._symbol === selectedSellToken?._symbol) {
        setSelectedSellToken(selectedBuyToken);
        setSelectedBuyToken(token);
      } else {
        setSelectedBuyToken(token);
      }
      setShowTokenSelectorBuy(false);
      setSellAmount("");
      setBuyAmount("");
    };

    const getPoolByTokenPair = async (tokenA: string, tokenB: string) => {
      try {
        const res = await axios.get(
          `/api/poolByTokenPair?tokenPair=${tokenA},${tokenB}`
        );
        setPool(res.data[0]);
        return res.data[0];
      } catch (err) {
        console.log(err);
      }
    };

    const getPairedSwapableTokens = async (address: string) => {
      try {
        const res = await axios.get(`/api/swapableTokenPairs/${address}`);
        setTokenList2(res.data);
      } catch (err) {
        console.log(err);
      }
    };

    const getTokenBalance = async (address: string) => {
      try {
        const res = await axios.get(
          `api/tokens/table/balance?key=eq.${userAddress}&address=eq.${address}`
        );
        setSelectedToken1Amount(res?.data[0]?.value || 0);
      } catch (err) {
        console.log(err);
      }
    };

    const handleInputChange = async (isSellInput: boolean, value: string) => {
      if (selectedSellToken && selectedBuyToken) {
        // Fetch the conversion rate from API
        try {
          if (!selectedSellToken.address || !selectedBuyToken?.address) return;

          // const pool = await getPoolByTokenPair(
          //   selectedSellToken.address,
          //   selectedBuyToken.address
          // );         
          if (isSellInput) {
            if (pool.data.tokenA === selectedSellToken.address) {
              setSellAmount(value);
              setBuyAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.aToBRatio || 0) * 10000
                ) /
                10000 +
                ""
              ); // Always rounds down with 6 decimal places
            } else {
              setSellAmount(value);
              setBuyAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.bToARatio || 0) * 10000
                ) /
                10000 +
                ""
              ); // Always rounds down with 6 decimal places
            }
          } else {
            if (pool.data.tokenA === selectedBuyToken.address) {
              setBuyAmount(value);
              setSellAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.aToBRatio || 0) * 1000000
                ) /
                1000000 +
                ""
              ); // Always rounds down with 6 decimal places
            } else {
              setBuyAmount(value);
              setSellAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.bToARatio || 0) * 1000000
                ) /
                1000000 +
                ""
              ); // Always rounds down with 6 decimal places
            }
          }
        } catch (err) {
          console.log(err);
        }
      } else {
        // If either token is not selected, don't perform conversion
        if (isSellInput) {
          setSellAmount(value);
        } else {
          setBuyAmount(value);
        }
      }
    };

    // Add swap action handler
    const handleSwapAction = async () => {
      setSwapLoading(true)
      if (!selectedSellToken || !selectedBuyToken) return;
      try {
        // Replace this with your actual pool address logic if different
        const method =
          pool.data.tokenA === selectedSellToken.address
            ? "tokenAToTokenB"
            : "tokenBToTokenA";

        const response = await axios.post("/api/swap/swap", {
          address: pool.address,
          method: method,
          amount: new BigNumber(sellAmount).multipliedBy(10 ** 18).toFixed(0),
          min_tokens: new BigNumber(buyAmount).multipliedBy(10 ** 18).multipliedBy(0.99).toFixed(0),
        });
        console.log("Swap response:", response.data);
        setSwapLoading(false)
        api['success']({
          message: 'Success',
          description:
            `Swapping succesfull from ${selectedSellToken?._name} to ${selectedBuyToken?._name}`,
        });
      } catch (error) {
        console.error("Swap error:", error);
        setSwapLoading(false)
        api['error']({
          message: 'Error',
          description:
            `Swapping Error - ${error}`,
        });
      }
    };

    const isSwapValid = selectedSellToken && selectedBuyToken && parseFloat(sellAmount) > 0 && parseFloat(buyAmount) > 0

    return (
      <div className="min-h-screen bg-gray-50 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-semibold text-gray-800">Swap</h1>
          </header>

          <div className="flex flex-col gap-2 bg-white rounded-2xl border border-gray-100 overflow-hidden relative">
            <div className="flex flex-col p-4 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-xs text-gray-500">
                  Sell
                </span>
              </div>
              <div className="flex items-center justify-end pt-2 pb-2 min-h-[59px] transform translate-x-0">
                <div className="flex items-center flex-grow h-9 mr-2 overflow-hidden opacity-100">
                  <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                    <input
                      type="number"
                      placeholder="0"
                      value={sellAmount}
                      onChange={(e) => handleInputChange(true, e.target.value)}
                      className="w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                      disabled={!selectedSellToken}
                    />
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                    {!selectedSellToken ? (
                      <button
                        onClick={() => {
                          setShowTokenSelectorSell(true);
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                      >
                        Select token
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setShowTokenSelectorSell(true);
                        }}
                        className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm"
                      >
                        <TokenIcon
                          symbol={selectedSellToken?._symbol || "NA"}
                          size="md"
                        />
                        <span className="font-medium text-base text-gray-900">
                          {selectedSellToken._name}
                        </span>
                        <svg
                          className="w-6 h-6 text-gray-400 rotate-90"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 text-sm text-gray-500">
                <span>{sellAmount ? sellAmount : 0}</span>
                <div className="flex items-center gap-2">
                  <span>{selectedToken1Amount}</span>
                  <button className="bg-gray-100 rounded-xl px-2 py-1 border border-gray-200 cursor-default">
                    Max
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex flex-col">
            <div
              onClick={() => {
                // Swap tokens
                const tempToken = selectedSellToken;
                setSelectedSellToken(selectedBuyToken || null);
                setSelectedBuyToken(tempToken || null);

                // Swap amounts
                const tempAmount = sellAmount;
                setSellAmount(buyAmount);
                setBuyAmount(tempAmount);
              }}
              className="flex flex-col items-center h-0"
            >
              <div className="absolute -bottom-6 flex flex-col items-center">
                <div
                  data-testid="switch-currencies-button"
                  className="flex flex-col items-stretch cursor-pointer bg-gray-100 border-white border-4 rounded-xl p-2 shadow"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    strokeWidth="2"
                    className="w-6 h-6 text-gray-900"
                  >
                    <path
                      d="M12 5V19"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M19 12L12 19L5 12"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-col relative box-border min-h-0 min-w-0 flex-shrink-0 border border-transparent bg-gray-100 rounded-md">
            <div className="flex flex-col relative box-border min-h-0 min-w-0 flex-shrink-0 cursor-pointer transform scale-100 opacity-100">
              <div className="flex flex-col relative box-border min-h-0 min-w-0 flex-shrink-0 overflow-hidden px-4 py-4">
                <div className="flex justify-between items-stretch">
                  <span className="inline-block whitespace-pre-wrap m-0 text-gray-700 font-bold text-sm leading-tight">
                    Buy
                  </span>
                </div>
                <div className="flex items-center justify-end pt-2 pb-2 min-h-[59px] transform translate-x-0">
                  <div className="flex items-center flex-grow h-9 mr-2 overflow-hidden opacity-100">
                    <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                      <input
                        type="number"
                        placeholder="0"
                        value={buyAmount}
                        onChange={(e) =>
                          handleInputChange(false, e.target.value)
                        }
                        className="w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                        disabled={!selectedBuyToken}
                      />
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                      {!selectedBuyToken ? (
                        <button
                          onClick={() => {
                            setShowTokenSelectorBuy(true);
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                        >
                          Select token
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setShowTokenSelectorBuy(true);
                          }}
                          className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm"
                        >
                          <TokenIcon
                            symbol={selectedBuyToken?._symbol || "NA"}
                            size="md"
                          />
                          <span className="font-medium text-base text-gray-900">
                            {selectedBuyToken._name}
                          </span>
                          <svg
                            className="w-6 h-6 text-gray-400 rotate-90"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z"
                              fill="currentColor"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 pointer-events-none">
                  <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                    <div className="flex items-center justify-center gap-1">
                      <span className="inline-block whitespace-nowrap m-0 text-gray-700 font-bold text-sm leading-tight overflow-hidden text-ellipsis">
                        $0
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col pt-4 pb-4">
            <button
              onClick={handleSwapAction}
              className={`rounded-xl py-4 text-lg font-medium flex justify-center gap-4 ${isSwapValid
                ? "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 cursor-pointer"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                } ${swapLoading ? "cursor-not-allowed" : ""}`}
              disabled={!isSwapValid || swapLoading}
            >
              {swapLoading && <Spin />}
              Swap
            </button>
          </div>

          {showTokenSelectorSell && (
            <TokenDropdown
              show={showTokenSelectorSell}
              onClose={() => setShowTokenSelectorSell(false)}
              tokenSearchQuery={tokenSearchQuerySell}
              setTokenSearchQuery={setTokenSearchQuerySell}
              popularTokens={tokenList}
              handleTokenSelect={handleSwapTokenSelectSell}
            />
          )}
          {showTokenSelectorBuy && (
            <TokenDropdown
              show={showTokenSelectorBuy}
              onClose={() => setShowTokenSelectorBuy(false)}
              tokenSearchQuery={tokenSearchQueryBuy}
              setTokenSearchQuery={setTokenSearchQueryBuy}
              popularTokens={tokenList2}
              handleTokenSelect={handleSwapTokenSelectBuy}
            />
          )}

          {/* Settings Modal */}
          {showSettings && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-3xl w-full max-w-md p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-medium">Settings</h2>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="p-2 hover:bg-gray-100 rounded-full"
                  >
                    <svg
                      className="w-5 h-5 text-gray-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Slippage tolerance
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSlippage("0.1")}
                        className={`px-3 py-2 rounded-lg ${slippage === "0.1"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                          }`}
                      >
                        0.1%
                      </button>
                      <button
                        onClick={() => setSlippage("0.5")}
                        className={`px-3 py-2 rounded-lg ${slippage === "0.5"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                          }`}
                      >
                        0.5%
                      </button>
                      <button
                        onClick={() => setSlippage("1.0")}
                        className={`px-3 py-2 rounded-lg ${slippage === "1.0"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                          }`}
                      >
                        1.0%
                      </button>
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={slippage}
                          onChange={(e) => setSlippage(e.target.value)}
                          className="w-full bg-gray-50 rounded-lg px-3 py-2 pr-8 focus:outline-none"
                          placeholder="Custom"
                        />
                        <span className="absolute right-3 top-2 text-gray-500">
                          %
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Transaction deadline
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        defaultValue="30"
                        className="w-full bg-gray-50 rounded-lg px-3 py-2 pr-12 focus:outline-none"
                      />
                      <span className="absolute right-3 top-2 text-gray-500">
                        minutes
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {contextHolder}
      </div>
    );
  };

  const RenderLiquidity = () => {
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
        key: "withdraw",
        label: (
          <span className="text-base font-semibold text-gray-700 transition-colors">
            Withdraw
          </span>
        ),
      },
    ];
    return (
      <>
        <motion.div
          className="w-[100%]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="w-full w-[100%] rounded-2xl shadow-lg">
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
              {activeTab2 === "deposits" ? (
                <RenderDeposits />
              ) : (
                <RenderWithdraw />
              )}
            </motion.div>
          </Card>
        </motion.div>
      </>
    )
  };

  const RenderDeposits = () => {
    const [tokenSearchQueryDeposit1, setTokenSearchQueryDeposit1] =
      useState("");
    const [tokenSearchQueryDeposit2, setTokenSearchQueryDeposit2] =
      useState("");
    const [showTokenSelectorDeposit, setShowTokenSelectorDeposit] =
      useState(false);
    const [selectedTokenDeposit1, setSelectedDepositToken1] =
      useState<TokenData>();
    const [selectedTokenDeposit2, setSelectedDepositToken2] =
      useState<TokenData | null>(null);
    const [selectingDepositToken, setSelectingDepositToken] = useState<
      1 | 2 | null
    >(null);

    useEffect(() => {
      if (selectedTokenDeposit1?.address) {
        const fetchPaired = async () => {
          try {
            const res = await axios.get(
              `/api/swapableTokenPairs/${selectedTokenDeposit1.address}`
            );
            setTokenList2(res.data);
          } catch (err) {
            console.error(err);
          }
        };
        fetchPaired();
      }
    }, [selectedTokenDeposit1]);

    const [tokenList, setTokenList] = useState<TokenData[]>([]);

    const [tokenList2, setTokenList2] = useState<TokenData[]>([]);

    // Deposit amounts and pool state
    const [depositAmount1, setDepositAmount1] = useState<string>("");
    const [depositAmount2, setDepositAmount2] = useState<string>("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pool, setPool] = useState<any>(null);
    const [liquidityLoading, setLiquidityLoading] = useState(false)
    const [api, contextHolder] = notification.useNotification();

    const getPoolByTokenPair = async (tokenA: string, tokenB: string) => {
      try {
        const res = await axios.get(
          `/api/poolByTokenPair?tokenPair=${tokenA},${tokenB}`
        );
        setPool(res.data[0]);
        return res.data[0];
      } catch (err) {
        console.error(err);
      }
    };

    useEffect(() => {
      if (selectedTokenDeposit1?.address && selectedTokenDeposit2?.address) {
        getPoolByTokenPair(
          selectedTokenDeposit1.address,
          selectedTokenDeposit2.address
        );
      }
    }, [selectedTokenDeposit1, selectedTokenDeposit2]);

    const handleInputChangeDeposit1 = (value: string) => {
      setDepositAmount1(value);
      if (pool?.data) {
        const ratio =
          pool.data.tokenA === selectedTokenDeposit1?.address
            ? pool.data.aToBRatio
            : pool.data.bToARatio;
        const calculated = new BigNumber(value)
          .multipliedBy(ratio)
          .multipliedBy(10000)
          .integerValue(BigNumber.ROUND_FLOOR)
          .dividedBy(10000)
          .toString();
        setDepositAmount2(calculated || "");
      }
    };

    const handleInputChangeDeposit2 = (value: string) => {
      setDepositAmount2(value);
      if (pool?.data) {
        const ratio =
          pool.data.tokenA === selectedTokenDeposit1?.address
            ? pool.data.bToARatio
            : pool.data.aToBRatio;
        const calculated = new BigNumber(value)
          .multipliedBy(ratio)
          .multipliedBy(10000)
          .integerValue(BigNumber.ROUND_FLOOR)
          .dividedBy(10000)
          .toString();
        setDepositAmount1(calculated || "");
      }
    };

    const handleAddLiquidity = async () => {
      if (!selectedTokenDeposit1 || !selectedTokenDeposit2) return;
      try {
        setLiquidityLoading(true)
        const response = await axios.post("/api/swap/addLiquidity", {
          address: pool.address,
          max_tokenA_amount: new BigNumber(
            pool.data.tokenA === selectedTokenDeposit1?.address
              ? depositAmount1
              : depositAmount2
          ).multipliedBy(10 ** 18).multipliedBy(1.01).toFixed(0),
          tokenB_amount: new BigNumber(
            pool.data.tokenA === selectedTokenDeposit1?.address
              ? depositAmount2
              : depositAmount1
          ).multipliedBy(10 ** 18).toFixed(0),
        });
        console.log("Add liquidity response:", response.data);
        setLiquidityLoading(false)
        api['success']({
          message: 'Success',
          description:
            `Succesfully added liquidity for ${selectedTokenDeposit1?._name} ${selectedTokenDeposit2?._name}`,
        });
      } catch (err) {
        console.error("Add liquidity error:", err);
        api['error']({
          message: 'Error',
          description:
            `Liquidity Error - ${err}`,
        });
        setLiquidityLoading(false)
      }
    };

    useEffect(() => {
      const fetchTokens = async () => {
        try {
          const res = await axios.get("api/swapableTokens");
          setTokenList(res.data);
        } catch (err) {
          console.log(err);
        }
      };

      fetchTokens();
    }, []);

    const handleTokenSelectDeposit = (token: TokenData) => {
      if (selectingDepositToken === 1) {
        setSelectedDepositToken1(token);
      } else if (selectingDepositToken === 2) {
        setSelectedDepositToken2(token);
      }
      setShowTokenSelectorDeposit(false);
      setSelectingDepositToken(null);
    };

    return (
      <div className="space-y-4">
        <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-12">
          <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-lg">
            <div className="max-w-6xl mx-auto">
              <div className="relative inline-flex items-center mb-4">
                <div className="w-full max-w-6xl mx-auto p-4">
                  <div className="flex flex-col md:flex-row justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">
                      Deposits
                    </h1>
                  </div>

                  <div className="sticky top-24 w-[100%] self-start flex justify-between">
                    <div className="flex flex-col flex-grow max-w-[660px] mb-8">
                      <div className="w-full p-6 border rounded-2xl border-gray-200 flex flex-col gap-8">
                        <div className="flex flex-col gap-4">
                          <h2 className="text-2xl font-bold text-gray-900">
                            Select pair
                          </h2>
                          <p className="text-sm text-gray-600">
                            Choose the tokens you want to provide liquidity for.
                            You can select tokens on all supported networks.
                          </p>
                          <div className="flex flex-col gap-8 mb-4">
                            <button
                              onClick={() => {
                                setShowTokenSelectorDeposit(true);
                                setSelectingDepositToken(1);
                              }}
                              className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
                            >
                              <div className="flex items-center gap-2">
                                {selectedTokenDeposit1 && <TokenIcon
                                  symbol={selectedTokenDeposit1?._symbol || ""}
                                  size="md"
                                />}
                                <span className="text-gray-800 font-medium">
                                  {selectedTokenDeposit1?._name ?? "Choose token"}
                                </span>
                              </div>
                              <svg
                                className="w-5 h-5 rotate-90"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                setShowTokenSelectorDeposit(true);
                                setSelectingDepositToken(2);
                              }}
                              className="flex items-center justify-between p-4 border rounded-xl border-gray-300 bg-gray-900 text-white w-full"
                            >
                              <div className="flex items-center gap-2">
                                {selectedTokenDeposit2 && <TokenIcon
                                  symbol={selectedTokenDeposit2?._symbol || ""}
                                  size="md"
                                />}
                                <span className="font-medium">
                                  {selectedTokenDeposit2?._name ?? "Choose token"}
                                </span>
                              </div>
                              <svg
                                className="w-5 h-5 rotate-90"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
                              </svg>
                            </button>
                          </div>
                          {selectedTokenDeposit1 && selectedTokenDeposit2 && (
                            <>
                              <div className="flex items-center">
                                <span className="text-lg font-bold text-neutral-900 flex-grow">
                                  Set price range
                                </span>
                              </div>
                              <div className="flex flex-col gap-3 relative min-w-0 min-h-0 flex-shrink-0 box-border">
                                <span className="inline whitespace-pre-wrap text-neutral-800 font-bold text-lg leading-snug">
                                  Deposit tokens
                                </span>

                                <span className="inline whitespace-pre-wrap text-neutral-600 font-semibold text-sm leading-relaxed">
                                  Specify the token amounts for your liquidity
                                  contribution.
                                </span>
                              </div>

                              <div className="flex flex-col rounded-2xl bg-surface2 overflow-hidden px-6 py-4">
                                <div className="flex flex-col bg-white rounded-[16px] px-4 py-4 overflow-hidden">
                                  <div className="flex items-center justify-between min-h-[59px]">
                                    <div className="flex flex-grow items-center overflow-hidden mr-4">
                                      <div className="flex flex-col flex-grow">
                                        <input
                                          type="text"
                                          placeholder="0"
                                          value={depositAmount1}
                                          onChange={(e) =>
                                            handleInputChangeDeposit1(
                                              e.target.value
                                            )
                                          }
                                          className="w-full text-[36px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 px-2 py-2">
                                      <div className="relative w-7 h-7">
                                        <TokenIcon
                                          symbol={
                                            selectedTokenDeposit1?._symbol || ""
                                          }
                                          size="md"
                                        />
                                      </div>
                                      <span className="text-lg font-medium text-gray-800">
                                        {selectedTokenDeposit1._symbol ?? "ETH"}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
                                    <span className="font-bold whitespace-nowrap">
                                      $0
                                    </span>

                                    <div className="flex items-center gap-2 ml-auto">
                                      <span className="font-bold">
                                        0{" "}
                                        {selectedTokenDeposit1._symbol ??
                                          "PAXG"}
                                      </span>
                                      <button
                                        className="flex items-center justify-center bg-gray-100 px-2 py-1 rounded-[12px] border border-gray-200 text-xs font-medium text-gray-600 cursor-not-allowed select-none"
                                        disabled
                                      >
                                        Max
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col rounded-2xl bg-surface2 overflow-hidden px-6 py-4">
                                <div className="flex flex-col bg-white rounded-[16px] px-4 py-4 overflow-hidden">
                                  <div className="flex items-center justify-between min-h-[59px]">
                                    <div className="flex flex-grow items-center overflow-hidden mr-4">
                                      <div className="flex flex-col flex-grow">
                                        <input
                                          type="text"
                                          placeholder="0"
                                          value={depositAmount2}
                                          onChange={(e) =>
                                            handleInputChangeDeposit2(
                                              e.target.value
                                            )
                                          }
                                          className="w-full text-[36px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                          disabled={!depositAmount1}
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 px-2 py-2">
                                      <div className="relative w-7 h-7">
                                        <TokenIcon
                                          symbol={
                                            selectedTokenDeposit2?._symbol || ""
                                          }
                                          size="md"
                                        />
                                      </div>
                                      <span className="text-lg font-medium text-gray-800">
                                        {selectedTokenDeposit2._symbol ??
                                          "PAXG"}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
                                    <span className="font-bold whitespace-nowrap">
                                      $0
                                    </span>

                                    <div className="flex items-center gap-2 ml-auto">
                                      <span className="font-bold">
                                        0{" "}
                                        {selectedTokenDeposit2._symbol ??
                                          "PAXG"}
                                      </span>
                                      <button
                                        className="flex items-center justify-center bg-gray-100 px-2 py-1 rounded-[12px] border border-gray-200 text-xs font-medium text-gray-600 cursor-not-allowed select-none"
                                        disabled
                                      >
                                        Max
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-10">
                        <button
                          onClick={handleAddLiquidity}
                          className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl ${depositAmount1 && depositAmount2
                            ? "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white cursor-pointer hover:bg-gray-900"
                            : "bg-gray-100 text-gray-500 cursor-not-allowed"
                            }`}
                          disabled={!(depositAmount1 && depositAmount2) || liquidityLoading}
                        >
                          {liquidityLoading && <Spin />}
                          Add Liquidity
                        </button>
                      </div>
                    </div>
                  </div>

                  {showTokenSelectorDeposit && (
                    <TokenDropdown
                      show={showTokenSelectorDeposit}
                      onClose={() => setShowTokenSelectorDeposit(false)}
                      tokenSearchQuery={tokenSearchQueryDeposit1}
                      setTokenSearchQuery={setTokenSearchQueryDeposit1}
                      popularTokens={tokenList}
                      handleTokenSelect={handleTokenSelectDeposit}
                    />
                  )}
                  {showTokenSelectorDeposit && selectingDepositToken === 2 && (
                    <TokenDropdown
                      show={showTokenSelectorDeposit}
                      onClose={() => setShowTokenSelectorDeposit(false)}
                      tokenSearchQuery={tokenSearchQueryDeposit2}
                      setTokenSearchQuery={setTokenSearchQueryDeposit2}
                      popularTokens={tokenList2}
                      handleTokenSelect={handleTokenSelectDeposit}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div >
        {contextHolder}
      </div >
    );
  };

  const RenderWithdraw = () => {
    // Replace state declarations with new state for LP pools and withdraw info
    const [lpPools, setLpPools] = useState<TokenData[]>([]);
    const [showTokenSelectorWithdraw, setShowTokenSelectorWithdraw] =
      useState(false);
    const [selectedWithdrawPool, setSelectedWithdrawPool] =
      useState<TokenData | null>(null);
    const [tokenSearchQueryWithdraw, setTokenSearchQueryWithdraw] =
      useState("");
    const [withdrawAmount, setWithdrawAmount] = useState<string>("");
    const [api, contextHolder] = notification.useNotification();
    const [withdrawLoading, setWithdrawLoading] = useState(false)

    // Withdraw handler
    const handleWithdraw = async () => {
      if (!selectedWithdrawPool) return;
      try {
        setWithdrawLoading(true)
        const response = await axios.post("/api/swap/removeLiquidity", {
          address: selectedWithdrawPool.address,
          amount: new BigNumber(withdrawAmount).multipliedBy(10 ** 18).toFixed(0),
        });
        console.log("Withdraw response:", response.data);
        api['success']({
          message: 'Success',
          description:
            `Succesfully withdrawed ${selectedWithdrawPool?._name}`,
        });
        setWithdrawLoading(false)
      } catch (err) {
        console.error("Withdraw error:", err);
        setWithdrawLoading(false)
        api['error']({
          message: 'Error',
          description:
            `Withdraw Error - ${err}`,
        });
      }
    };

    // Fetch pools the user has deposited into
    useEffect(() => {
      const fetchUserPools = async () => {
        try {
          const res = await axios.get(`/api/lpToken/`);
          setLpPools(res.data);
        } catch (err) {
          console.error(err);
        }
      };
      fetchUserPools();
    }, []);

    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-12">
        <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
          <div className="w-full p-6 border rounded-2xl border-gray-200 flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold text-gray-900">Select pool</h2>
              <div className="flex flex-col gap-8">
                <button
                  onClick={() => {
                    setShowTokenSelectorWithdraw(true);
                  }}
                  className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
                >
                  <div className="flex items-center gap-2">
                    <TokenIcon
                      symbol={selectedWithdrawPool?._symbol || ""}
                      size="md"
                    />
                    <span className="text-gray-800 font-medium">
                      {selectedWithdrawPool?._symbol ?? "Select pool"}
                    </span>
                  </div>
                  <svg
                    className="w-5 h-5 rotate-90"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
                  </svg>
                </button>
                <input
                  type="number"
                  placeholder="0"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  className="w-full p-4 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 placeholder-gray-400"
                  disabled={!selectedWithdrawPool}
                />
                {selectedWithdrawPool && (
                  <div className="text-sm text-gray-600 mt-1">
                    Max available LP tokens:{" "}
                    {Number(selectedWithdrawPool.value) / 1e18}{" "}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-10">
            <button
              onClick={handleWithdraw}
              className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition 
    ${parseFloat(withdrawAmount) > 0 && selectedWithdrawPool
                  ? "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white cursor-pointer hover:bg-gray-900"
                  : "bg-gray-100 text-gray-500 cursor-not-allowed"
                }`}
              disabled={
                !(parseFloat(withdrawAmount) > 0 && selectedWithdrawPool) || withdrawLoading
              }
            >
              {withdrawLoading && <Spin />}  Withdraw
            </button>
          </div>
          {showTokenSelectorWithdraw && (
            <TokenDropdown
              show={showTokenSelectorWithdraw}
              onClose={() => setShowTokenSelectorWithdraw(false)}
              tokenSearchQuery={tokenSearchQueryWithdraw}
              setTokenSearchQuery={setTokenSearchQueryWithdraw}
              popularTokens={lpPools}
              handleTokenSelect={(pool) => {
                setSelectedWithdrawPool(pool);
                setShowTokenSelectorWithdraw(false);
                setWithdrawAmount("");
              }}
            />
          )}
        </div>
        {contextHolder}
      </div>
    );
  };

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
        className="w-full w-[100%] rounded-2xl shadow-lg"
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

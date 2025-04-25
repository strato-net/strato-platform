"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  Select,
  Tabs,
  TabsProps,
} from "antd";
import { motion } from "framer-motion";
const { TabPane } = Tabs;
import Link from "next/link";
import TokenDropdown from "@/components/_dropdown/page";
import axios from "axios";
import { popularTokens } from "@/context/TokenContext";
import TokenIcon from "../icons/TokenIcon";


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

const SwapPanel: any = () => {
  const [activeTab, setActiveTab] = useState<"swap" | "liquidity">("swap");
  const [activeTab2, setActiveTab2] = useState<"deposits" | "withdraw">(
    "deposits"
  );
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [selectedToken1, setSelectedToken1] = useState<any>();
  const [selectedToken2, setSelectedToken2] = useState<any | null>(null);
  const [selectingToken, setSelectingToken] = useState<1 | 2 | null>(null);

  // const [tokenList, setTokenList] = useState([{
  //   name: '',
  //   symbol: '',
  //   address: ''
  // }])

  // useEffect(() => {
  //   axios.get('http://localhost:3001/api/tokens/')
  //     .then(res => {
  //       console.log(res, 'res');
  //       const formattedData = res.data.map((d: any) => {
  //         const name = d._name || '';
  //         return {
  //           name,
  //           symbol: name.slice(0, 2).toUpperCase(), // Get first 2 letters as symbol
  //           address: d.address || ''
  //         };
  //       });
  //       console.log(formattedData, 'formattedData');
  //       setTokenList(formattedData);
  //     })
  //     .catch(err => console.log(err))
  // }, []);

  // useEffect(() => {
  //   console.log(tokenList, 'tokenList');
  // }, [tokenList])



  const handleTokenSelect = (token: (typeof popularTokens)[0]) => {
    if (selectingToken === 1) {
      setSelectedToken1(token);
    } else if (selectingToken === 2) {
      setSelectedToken2(token);
    }
    setShowTokenSelector(false);
    setSelectingToken(null);
  };

  const handleClick = () => {
    console.log("conditionallay rendered button");
  };

  const RenderSwap = () => {
    const [tokenSearchQuery, setTokenSearchQuery] = useState('');
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedToken1, setSelectedToken1] = useState<any | null>(popularTokens[0]);
    const [selectedToken2, setSelectedToken2] = useState<any | null>(null);
    const [selectingToken, setSelectingToken] = useState<1 | 2 | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [slippage, setSlippage] = useState('0.5');
    const [sellAmount, setSellAmount] = useState('');
    const [buyAmount, setBuyAmount] = useState('');
    // const [tokenList, setTokenList] = useState([{
    //   name: '',
    //   symbol: '',
    //   address: ''
    // }])

    // useEffect(() => {
    //   axios.get('http://localhost:3001/api/tokens/')
    //     .then(res => {
    //       console.log(res, 'res');
    //       const formattedData = res.data.map((d: any) => {
    //         const name = d._name || '';
    //         return {
    //           name,
    //           symbol: name.slice(0, 2).toUpperCase(), // Get first 2 letters as symbol
    //           address: d.address || ''
    //         };
    //       });
    //       console.log(formattedData, 'formattedData');
    //       setTokenList(formattedData);
    //     })
    //     .catch(err => console.log(err))
    // }, []);

    // useEffect(() => {
    //   console.log(tokenList, 'tokenList');
    // }, [tokenList])


    const handleTokenSelect = (token: typeof popularTokens[0]) => {
      if (selectingToken === 1) {
        // If the selected token is the same as the token in the second field, swap them
        if (token._symbol === selectedToken2?._symbol) {
          setSelectedToken2(selectedToken1);
          setSelectedToken1(token);
        } else {
          setSelectedToken1(token);
        }
      } else if (selectingToken === 2) {
        // If the selected token is the same as the token in the first field, swap them
        if (token._symbol === selectedToken1?._symbol) {
          setSelectedToken1(selectedToken2);
          setSelectedToken2(token);
        } else {
          setSelectedToken2(token);
        }
      }
      setShowTokenSelector(false);
      setSelectingToken(null);
    };

    console.log(selectedToken1, "token>>");


    return (
      <div className="min-h-screen bg-gray-50 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <header className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-semibold text-gray-800">Swap</h1>
          </header>

          <div className="flex flex-col gap-2 bg-white rounded-2xl border border-gray-100 overflow-hidden relative">
            <div className="flex flex-col p-4 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-xs text-gray-500">Sell</span>
              </div>
              <div className="flex items-center justify-end pt-2 pb-2 min-h-[59px] transform translate-x-0">
                <div className="flex items-center flex-grow h-9 mr-2 overflow-hidden opacity-100">
                  <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                    <input
                      type="number"
                      placeholder="0"
                      value={sellAmount}
                      onChange={(e) => setSellAmount(e.target.value)}
                      className="w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                      disabled={!selectedToken1}
                    />
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                    {!selectedToken1 ? (
                      <button
                        onClick={() => {
                          setShowTokenSelector(true);
                          setSelectingToken(1);
                        }}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                      >
                        Select token
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setShowTokenSelector(true);
                          setSelectingToken(1);
                        }}
                        className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm"
                      >
                        <TokenIcon symbol={selectedToken1?._symbol || 'NA'} size="md" />
                        <span className="font-medium text-base text-gray-900">{selectedToken1._name}</span>
                        <svg className="w-6 h-6 text-gray-400 rotate-90" viewBox="0 0 24 24" fill="none">
                          <path d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

              </div>
              <div className="flex justify-between items-center pt-2 text-sm text-gray-500">
                <span>${sellAmount ? sellAmount : 0}</span>
                <div className="flex items-center gap-2">
                  <span>0 {selectedToken1 ? selectedToken1._symbol : 'ETH'}</span>
                  <button className="bg-gray-100 rounded-xl px-2 py-1 border border-gray-200 cursor-default">Max</button>
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 flex flex-col">
            <div
              onClick={() => {
                // Swap tokens
                const tempToken = selectedToken1;
                setSelectedToken1(selectedToken2 || null);
                setSelectedToken2(tempToken || null);

                // Swap amounts
                const tempAmount = sellAmount;
                setSellAmount(buyAmount);
                setBuyAmount(tempAmount);
              }}
              className="flex flex-col items-center h-0">
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
                  <span className="inline-block whitespace-pre-wrap m-0 text-gray-700 font-bold text-sm leading-tight">Buy</span>
                </div>
                <div className="flex items-center justify-end pt-2 pb-2 min-h-[59px] transform translate-x-0">
                  <div className="flex items-center flex-grow h-9 mr-2 overflow-hidden opacity-100">
                    <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                      <input
                        type="number"
                        placeholder="0"
                        value={buyAmount}
                        onChange={(e) => setBuyAmount(e.target.value)}
                        className="w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                        disabled={!selectedToken2}
                      />
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                      {!selectedToken2 ? (
                        <button
                          onClick={() => {
                            setShowTokenSelector(true);
                            setSelectingToken(2);
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                        >
                          Select token
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setShowTokenSelector(true);
                            setSelectingToken(2);
                          }}
                          className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm"
                        >
                          <TokenIcon symbol={selectedToken2?._symbol || 'NA'} size="md" />
                          <span className="font-medium text-base text-gray-900">{selectedToken2._name}</span>
                          <svg className="w-6 h-6 text-gray-400 rotate-90" viewBox="0 0 24 24" fill="none">
                            <path d="M15.7 5.3a1 1 0 0 1 0 1.4L10.4 12l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0z" fill="currentColor" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 pointer-events-none">
                  <div className="flex flex-col cursor-pointer transform scale-100 opacity-100">
                    <div className="flex items-center justify-center gap-1">
                      <span className="inline-block whitespace-nowrap m-0 text-gray-700 font-bold text-sm leading-tight overflow-hidden text-ellipsis">$0</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col pt-4 pb-4">
            <button
              className="bg-gray-100 text-gray-500 rounded-xl py-4 text-lg font-medium cursor-pointer">
              Swap token
            </button>
          </div>

          {showTokenSelector && (
            <TokenDropdown
              show={showTokenSelector}
              onClose={() => setShowTokenSelector(false)}
              tokenSearchQuery={tokenSearchQuery}
              setTokenSearchQuery={setTokenSearchQuery}
              popularTokens={popularTokens}
              handleTokenSelect={handleTokenSelect}
            />
          )}

          {/* Settings Modal */}
          {showSettings && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-3xl w-full max-w-md p-4">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-medium">Settings</h2>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
                        onClick={() => setSlippage('0.1')}
                        className={`px-3 py-2 rounded-lg ${slippage === '0.1'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                      >
                        0.1%
                      </button>
                      <button
                        onClick={() => setSlippage('0.5')}
                        className={`px-3 py-2 rounded-lg ${slippage === '0.5'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                      >
                        0.5%
                      </button>
                      <button
                        onClick={() => setSlippage('1.0')}
                        className={`px-3 py-2 rounded-lg ${slippage === '1.0'
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
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
                        <span className="absolute right-3 top-2 text-gray-500">%</span>
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
                      <span className="absolute right-3 top-2 text-gray-500">minutes</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLiquidity = () => (
    <>
      <motion.div
        className="w-[100%]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="w-full w-[100%] rounded-2xl shadow-lg">
          <Tabs
            activeKey={activeTab2}
            onChange={(k) => setActiveTab2(k as any)}
            centered
            className="custom-subTabs"
          >
            <TabPane tab="Deposits" key="deposits" />
            <TabPane tab="Withdraw" key="withdraw" />
          </Tabs>
          <div className="mt-4">
            {activeTab2 === "deposits" ? <RenderDeposits /> : <RenderWithdraw />}
          </div>
        </Card>
      </motion.div>
    </>
  );

  const RenderDeposits = () => {
    return (
      <div className="space-y-4">
        <div className="bg-white min-h-screen p-6 text-gray-900">
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
                          Choose the tokens you want to provide liquidity for. You
                          can select tokens on all supported networks.
                        </p>
                        <div className="flex flex-col md:flex-row gap-4">
                          <button
                            onClick={() => {
                              setShowTokenSelector(true);
                              setSelectingToken(1);
                            }}
                            className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
                          >
                            <div className="flex items-center gap-2">
                              <TokenIcon symbol={selectedToken1?._symbol || ''} size="md" />
                              <span className="text-gray-800 font-medium">
                                {selectedToken1?._name ?? "ETH"}
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
                              setShowTokenSelector(true);
                              setSelectingToken(2);
                            }}
                            className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-900 text-white w-full"
                          >
                            <span className="font-medium">
                              {" "}
                              {selectedToken2?._name ?? "Choose token"}
                            </span>
                            <svg
                              className="w-5 h-5 rotate-90"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
                            </svg>
                          </button>
                        </div>
                        {selectedToken1 && selectedToken2 && (
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
                                        className="w-full text-[36px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 px-2 py-2">
                                    <div className="relative w-7 h-7">
                                      <TokenIcon symbol={selectedToken1?._symbol || ''} size="md" />
                                    </div>
                                    <span className="text-lg font-medium text-gray-800">
                                      {selectedToken1._symbol ?? 'ETH'}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
                                  <span className="font-bold whitespace-nowrap">
                                    $0
                                  </span>

                                  <div className="flex items-center gap-2 ml-auto">
                                    <span className="font-bold">0 {selectedToken1._symbol ?? 'PAXG'}</span>
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
                                        className="w-full text-[36px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 px-2 py-2">
                                    <div className="relative w-7 h-7">
                                      <TokenIcon symbol={selectedToken2?._symbol || ''} size="md" />
                                    </div>
                                    <span className="text-lg font-medium text-gray-800">
                                      {selectedToken2._symbol ?? 'PAXG'}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
                                  <span className="font-bold whitespace-nowrap">
                                    $0
                                  </span>

                                  <div className="flex items-center gap-2 ml-auto">
                                    <span className="font-bold">0 {selectedToken2._symbol ?? 'PAXG'}</span>
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
                        className={`w-full px-6 py-4 font-semibold rounded-xl ${selectedToken1 && selectedToken2
                          ? "bg-blue-600 text-white cursor-pointer"
                          : "bg-gray-100 text-gray-500 cursor-not-allowed"
                          }`}
                        disabled={!(selectedToken1 && selectedToken2)}
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                </div>

                {showTokenSelector && (
                  <TokenDropdown
                    show={showTokenSelector}
                    onClose={() => setShowTokenSelector(false)}
                    tokenSearchQuery={tokenSearchQuery}
                    setTokenSearchQuery={setTokenSearchQuery}
                    popularTokens={popularTokens}
                    handleTokenSelect={handleTokenSelect}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const RenderWithdraw = () => {
    const [withdrawAmount, setWithdrawAmount] = useState<number>(0)
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedWithdrawToken, setSelectedWithdrawToken] = useState(popularTokens[0])

    const handleTokenSelect = (token: any) => {
      setSelectedWithdrawToken(token)
      setShowTokenSelector(false)

    }
    return (
      <div className="flex flex-col flex-grow mb-8">
        <div className="w-full p-6 border rounded-2xl border-gray-200 flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold text-gray-900">Select pool</h2>
            <div className="flex flex-col md:flex-row gap-4">
              <button
                onClick={() => {
                  setShowTokenSelector(true);
                  setSelectingToken(1);
                }}
                className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
              >
                <div className="flex items-center gap-2">
                  <TokenIcon symbol={selectedWithdrawToken?._symbol || ''} size="md" />
                  <span className="text-gray-800 font-medium">
                    {selectedWithdrawToken._name ?? "ETH"}
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
                onChange={(e) => setWithdrawAmount(Number(e.target.value))}
                className="w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                disabled={!selectedWithdrawToken}
              />
            </div>
          </div>
        </div>

        <div className="mt-10">
          <button
            className={`w-full px-6 py-4 font-semibold rounded-xl transition 
    ${withdrawAmount > 0 && selectedWithdrawToken
                ? 'bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white cursor-pointer hover:bg-gray-900'
                : 'bg-gray-100 text-gray-500 cursor-not-allowed'
              }`}
            disabled={!(withdrawAmount > 0 && selectedWithdrawToken)}
          >
            Withdraw
          </button>
        </div>{showTokenSelector && (
          <TokenDropdown
            show={showTokenSelector}
            onClose={() => setShowTokenSelector(false)}
            tokenSearchQuery={tokenSearchQuery}
            setTokenSearchQuery={setTokenSearchQuery}
            popularTokens={popularTokens}
            handleTokenSelect={handleTokenSelect}
          />
        )}
      </div>
    )
  }

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
            <h1 className="text-2xl font-bold text-gray-800">Swap & Liquidity</h1>
          </div>
        }
        className="w-full w-[100%] rounded-2xl shadow-lg"
      >
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={(k) => setActiveTab((k as any))}
          centered
          className="custom-tabs-vibrant"
        />
        <div className={`mt-4 mb-20 ${activeTab === "swap" ? "h-[440px]" : "h-auto"}`}>
          {activeTab === "swap" ? <RenderSwap /> : renderLiquidity()}
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

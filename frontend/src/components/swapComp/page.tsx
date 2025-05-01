import { notification, Spin } from "antd";
import TokenDropdown from "../_dropdown/page";
import TokenIcon from "@/app/icons/TokenIcon";
import axios from "axios";
import { TokenData } from "@/interface/token";
import { useEffect, useState } from "react";
import { useUser } from "@/context/UserContext";
import { BigNumber } from "bignumber.js"

 export const RenderSwap = () => {
    const [tokenSearchQuerySell, setTokenSearchQuerySell] = useState("");
    const [tokenSearchQueryBuy, setTokenSearchQueryBuy] = useState("");
    const [showTokenSelectorSell, setShowTokenSelectorSell] = useState(false);
    const [showTokenSelectorBuy, setShowTokenSelectorBuy] = useState(false);
    const [selectedSellToken, setSelectedSellToken] = useState<
      TokenData | null
    >(null);
    const [selectedBuyToken, setSelectedBuyToken] = useState<TokenData | null>(
      null,
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
    const [swapLoading, setSwapLoading] = useState(false);
    const [balanceLoading, setBalanceLoading] = useState(false);
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
          `/api/poolByTokenPair?tokenPair=${tokenA},${tokenB}`,
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
        setBalanceLoading(true);
        const res = await axios.get(
          `api/tokens/table/balance?key=eq.${userAddress}&address=eq.${address}`,
        );
        setSelectedToken1Amount(res?.data[0]?.value || 0);
        setBalanceLoading(false);
      } catch (err) {
        console.log(err);
        setBalanceLoading(false);
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
          const parsedValue = new BigNumber(value || "0");

          // Convert on-chain balance (in wei) to readable form
          const maxSell = new BigNumber(selectedToken1Amount || "0").dividedBy(
            1e18,
          );

          if (isSellInput) {
            if (parsedValue.gt(maxSell)) {
              return;
            }
            if (pool.data.tokenA === selectedSellToken.address) {
              setSellAmount(value);
              setBuyAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.aToBRatio || 0) * 10000,
                ) /
                10000 +
                "",
              ); // Always rounds down with 6 decimal places
            } else {
              setSellAmount(value);
              setBuyAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.bToARatio || 0) * 10000,
                ) /
                10000 +
                "",
              ); // Always rounds down with 6 decimal places
            }
          } else {
            if (pool.data.tokenA === selectedBuyToken.address) {
              setBuyAmount(value);
              setSellAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.aToBRatio || 0) * 1000000,
                ) /
                1000000 +
                "",
              ); // Always rounds down with 6 decimal places
            } else {
              setBuyAmount(value);
              setSellAmount(
                Math.floor(
                  parseFloat(value) * (pool.data.bToARatio || 0) * 1000000,
                ) /
                1000000 +
                "",
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
      setSwapLoading(true);
      if (!selectedSellToken || !selectedBuyToken) return;
      try {
        // Replace this with your actual pool address logic if different
        const method = pool.data.tokenA === selectedSellToken.address
          ? "tokenAToTokenB"
          : "tokenBToTokenA";

        const response = await axios.post("/api/swap/swap", {
          address: pool.address,
          method: method,
          amount: new BigNumber(sellAmount).multipliedBy(10 ** 18).toFixed(0),
          min_tokens: new BigNumber(buyAmount).multipliedBy(10 ** 18)
            .multipliedBy(0.99).toFixed(0),
        });
        console.log("Swap response:", response.data);
        setSwapLoading(false);
        api["success"]({
          message: "Success",
          description:
            `Swapping Done Successfully from ${selectedSellToken?._name} to ${selectedBuyToken?._name}`,
        });
      } catch (error) {
        console.error("Swap error:", error);
        setSwapLoading(false);
        api["error"]({
          message: "Error",
          description: `Swapping Error - ${error}`,
        });
      }
    };

    const handleMaxClick = () => {
      setSellAmount(
        new BigNumber(selectedToken1Amount).dividedBy(10 ** 18).toString(),
      );
      handleInputChange(
        true,
        new BigNumber(selectedToken1Amount).dividedBy(10 ** 18).toString(),
      );
    };

    const isSwapValid = selectedSellToken && selectedBuyToken &&
      parseFloat(sellAmount) > 0 && parseFloat(buyAmount) > 0;

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
                      className="no-spinner w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                      disabled={!selectedSellToken}
                    />
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                    {!selectedSellToken
                      ? (
                        <button
                          onClick={() => {
                            setShowTokenSelectorSell(true);
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                        >
                          Select token
                        </button>
                      )
                      : (
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
                  <span>
                    {balanceLoading
                      ? <Spin />
                      : new BigNumber(selectedToken1Amount).dividedBy(1e18)
                        .toString()}
                  </span>

                  <button
                    disabled={balanceLoading || selectedToken1Amount == 0}
                    onClick={handleMaxClick}
                    className={`bg-gray-200 rounded-xl px-2 py-1 border border-gray-200 ${balanceLoading || selectedToken1Amount == 0
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer opacity-100"
                      }`}
                  >
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
                getTokenBalance(selectedBuyToken?.address || "");

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
                          handleInputChange(false, e.target.value)}
                        className="no-spinner w-full text-3xl font-bold text-gray-900 border-none outline-none placeholder-gray-300"
                        disabled={!selectedBuyToken}
                      />
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="flex flex-col cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full border border-gray-200 shadow-md transform scale-100 opacity-100">
                      {!selectedBuyToken
                        ? (
                          <button
                            onClick={() => {
                              setShowTokenSelectorBuy(true);
                            }}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white rounded-full text-base font-medium shadow"
                          >
                            Select token
                          </button>
                        )
                        : (
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
import TokenIcon from "@/app/icons/TokenIcon";
import { useTokens } from "@/context/TokenContext";
import { useUser } from "@/context/UserContext";
import { RefetchPoolProps, TokenData } from "@/interface/token";
import { notification, Spin } from "antd";
import axios from "axios";
import { useEffect, useState } from "react";
import TokenDropdown from "../_dropdown/page";
import { BigNumber } from "bignumber.js"

export const RenderDeposits = ({ refetchPools }: RefetchPoolProps) => {
    const [tokenSearchQueryDeposit1, setTokenSearchQueryDeposit1] = useState(
      "",
    );
    const [tokenSearchQueryDeposit2, setTokenSearchQueryDeposit2] = useState(
      "",
    );
    const [showTokenSelectorDeposit, setShowTokenSelectorDeposit] = useState(
      false,
    );
    const [selectedTokenDeposit1, setSelectedDepositToken1] = useState<
      TokenData
    >();
    const [selectedTokenDeposit2, setSelectedDepositToken2] = useState<
      TokenData | null
    >(null);
    const [selectingDepositToken, setSelectingDepositToken] = useState<
      1 | 2 | null
    >(null);

    useEffect(() => {
      if (selectedTokenDeposit1?.address) {
        const fetchPaired = async () => {
          try {
            const res = await axios.get(
              `/api/swapableTokenPairs/${selectedTokenDeposit1.address}`,
            );
            setTokenList2(res.data);
          } catch (err) {
            console.error(err);
          }
        };
        fetchPaired();
      }
    }, [selectedTokenDeposit1]);

    const { tokens } = useTokens()

    const [tokenList, setTokenList] = useState<TokenData[]>([]);

    const [tokenList2, setTokenList2] = useState<TokenData[]>([]);

    // Deposit amounts and pool state
    const [depositAmount1, setDepositAmount1] = useState<string>("");
    const [depositAmount2, setDepositAmount2] = useState<string>("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pool, setPool] = useState<any>(null);
    const [liquidityLoading, setLiquidityLoading] = useState(false);
    const [api, contextHolder] = notification.useNotification();
    const { userAddress } = useUser();
    const [selectedToken1Amount, setSelectedToken1Amount] = useState("");
    const [selectedToken2Amount, setSelectedToken2Amount] = useState("");
    const [initialPrice, setInitialPrice] = useState("");
    const [tokenAmount1, setTokenAmount1] = useState("");
    const [tokenAmount2, setTokenAmount2] = useState("");


    const getPoolByTokenPair = async (tokenA: string, tokenB: string) => {
      try {
        const res = await axios.get(
          `/api/poolByTokenPair?tokenPair=${tokenA},${tokenB}`,
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
          selectedTokenDeposit2.address,
        );
      }
    }, [selectedTokenDeposit1, selectedTokenDeposit2]);

    const handleInputChangeDeposit1 = (value: string) => {
      const parsedValue = new BigNumber(value || "0");

      // Convert on-chain balance (in wei) to readable form
      const maxValue = new BigNumber(selectedToken1Amount || "0").dividedBy(
        1e18,
      );
      if (parsedValue.gt(maxValue)) {
        return;
      }
      setDepositAmount1(value);
      if (pool?.data) {
        const ratio = pool.data.tokenA === selectedTokenDeposit1?.address
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
      const parsedValue = new BigNumber(value || "0");

      // Convert on-chain balance (in wei) to readable form
      const maxValue = new BigNumber(selectedToken2Amount || "0").dividedBy(
        1e18,
      );
      if (parsedValue.gt(maxValue)) {
        return;
      }
      setDepositAmount2(value);
      if (pool?.data) {
        const ratio = pool.data.tokenA === selectedTokenDeposit1?.address
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
        setLiquidityLoading(true);
        const response = await axios.post("/api/swap/addLiquidity", {
          address: pool.address,
          max_tokenA_amount: new BigNumber(
            pool.data.tokenA === selectedTokenDeposit1?.address
              ? depositAmount1
              : depositAmount2,
          ).multipliedBy(10 ** 18).multipliedBy(1.01),
          tokenB_amount: new BigNumber(
            pool.data.tokenA === selectedTokenDeposit1?.address
              ? depositAmount2
              : depositAmount1,
          ).multipliedBy(10 ** 18),
        });
        console.log("Add liquidity response:", response.data);
        setLiquidityLoading(false);
        api["success"]({
          message: "Success",
          description:
            `Successfully added liquidity for ${selectedTokenDeposit1?._name} ${selectedTokenDeposit2?._name}`,
        });
        await refetchPools()
      } catch (err) {
        console.error("Add liquidity error:", err);
        api["error"]({
          message: "Error",
          description: `Liquidity Error - ${err}`,
        });
        setLiquidityLoading(false);
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

    console.log(tokenList, "tokenList");
    

    const handleTokenSelectDeposit = (token: TokenData) => {
      if (selectingDepositToken === 1) {
        setSelectedDepositToken1(token);
        getTokenBalance(token?.address || "", true);
      } else if (selectingDepositToken === 2) {
        setSelectedDepositToken2(token);
        getTokenBalance(token?.address || "");
      }
      setShowTokenSelectorDeposit(false);
      setSelectingDepositToken(null);
    };

    const getTokenBalance = async (
      address: string,
      firstToken: boolean = false,
    ) => {
      try {
        const res = await axios.get(
          `api/tokens/table/balance?key=eq.${userAddress}&address=eq.${address}`,
        );
        if (firstToken) {
          setSelectedToken1Amount(res?.data[0]?.value || 0);
        } else {
          setSelectedToken2Amount(res?.data[0]?.value || 0);
        }
      } catch (err) {
        console.log(err);
      }
    };

    const handleMaxClick = (firstToken: boolean = false) => {
      if (firstToken) {
        setDepositAmount1(
          new BigNumber(selectedToken1Amount).dividedBy(10 ** 18).toString(),
        );
        handleInputChangeDeposit1(
          new BigNumber(selectedToken1Amount).dividedBy(10 ** 18).toString(),
        );
      } else {
        setDepositAmount2(
          new BigNumber(selectedToken2Amount).dividedBy(10 ** 18).toString(),
        );
        handleInputChangeDeposit2(
          new BigNumber(selectedToken2Amount).dividedBy(10 ** 18).toString(),
        );
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = e.target;

      switch (name) {
        case "initialPrice":
          setInitialPrice(value);
          break;
        case "tokenAmount1":
          setTokenAmount1(value);
          break;
        case "tokenAmount2":
          setTokenAmount2(value);
          break;
        default:
          break;
      }
    };

    return (
      <div className="space-y-4">
        <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-12">
          <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-auto">
            <div className="w-auto mx-auto">
              <div className="relative inline-flex items-center mb-4">
                <div className="w-auto mx-auto p-4">
                  <div className="flex flex-col md:flex-row justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">
                      Deposit
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
                                {selectedTokenDeposit1 && (
                                  <TokenIcon
                                    symbol={selectedTokenDeposit1?._symbol ||
                                      ""}
                                    size="md"
                                  />
                                )}
                                <span className="text-gray-800 font-medium">
                                  {selectedTokenDeposit1?._name ??
                                    "Choose token"}
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
                                {selectedTokenDeposit2 && (
                                  <TokenIcon
                                    symbol={selectedTokenDeposit2?._symbol ||
                                      ""}
                                    size="md"
                                  />
                                )}
                                <span className="font-medium">
                                  {selectedTokenDeposit2?._name ??
                                    "Choose token"}
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
                          {selectedTokenDeposit1 && selectedTokenDeposit2 && tokenList2.length > 0 && (
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

                              <div className="flex flex-col rounded-2xl bg-surface2 overflow-hidden px-2 py-4">
                                <div className="flex flex-col bg-white rounded-[16px] px-2 py-4 overflow-hidden">
                                  <div className="flex items-center justify-between min-h-[59px]">
                                    <div className="flex flex-grow items-center overflow-hidden mr-4">
                                      <div className="flex flex-col flex-grow">
                                        <input
                                          type="number"
                                          min={0}
                                          placeholder="0"
                                          value={depositAmount1}
                                          onChange={(e) =>
                                            handleInputChangeDeposit1(
                                              e.target.value,
                                            )}
                                          className="no-spinner w-full text-[30px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 px-2 py-2">
                                      <div className="relative w-7 h-7">
                                        <TokenIcon
                                          symbol={selectedTokenDeposit1
                                            ?._symbol || ""}
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
                                      {depositAmount1}
                                    </span>

                                    <div className="flex items-center gap-2 ml-auto">
                                      <span className="font-bold">
                                        {new BigNumber(selectedToken1Amount)
                                          .dividedBy(10 ** 18).toFixed(4)}{" "}
                                        {selectedTokenDeposit1._symbol ??
                                          "PAXG"}
                                      </span>
                                      <button
                                        onClick={() => handleMaxClick(true)}
                                        className={`bg-gray-200 rounded-xl px-2 py-1 border border-gray-200 ${selectedToken1Amount == "0"
                                          ? "cursor-not-allowed opacity-50"
                                          : "cursor-pointer opacity-100"
                                          }`}
                                        disabled={selectedToken1Amount == "0"}
                                      >
                                        Max
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col rounded-2xl bg-surface2 overflow-hidden px-2 py-4">
                                <div className="flex flex-col bg-white rounded-[16px] px-2 py-4 overflow-hidden">
                                  <div className="flex items-center justify-between min-h-[59px]">
                                    <div className="flex flex-grow items-center overflow-hidden mr-4">
                                      <div className="flex flex-col flex-grow">
                                        <input
                                          type="number"
                                          min={0}
                                          placeholder="0"
                                          value={depositAmount2}
                                          onChange={(e) =>
                                            handleInputChangeDeposit2(
                                              e.target.value,
                                            )}
                                          className="no-spinner w-full text-[30px] leading-[43px] text-gray-800 font-bold focus:outline-none bg-transparent placeholder:text-gray-400"
                                          disabled={!depositAmount1}
                                        />
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 px-2 py-2">
                                      <div className="relative w-7 h-7">
                                        <TokenIcon
                                          symbol={selectedTokenDeposit2
                                            ?._symbol || ""}
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
                                      {depositAmount2}
                                    </span>

                                    <div className="flex items-center gap-2 ml-auto">
                                      <span className="font-bold">
                                        {new BigNumber(selectedToken2Amount)
                                          .dividedBy(10 ** 18).toFixed(4)}{" "}
                                        {selectedTokenDeposit2._symbol ??
                                          "PAXG"}
                                      </span>
                                      <button
                                        onClick={() => handleMaxClick(false)}
                                        className={`bg-gray-200 rounded-xl px-2 py-1 border border-gray-200 ${selectedToken2Amount == "0"
                                          ? "cursor-not-allowed opacity-50"
                                          : "cursor-pointer opacity-100"
                                          }`}
                                        disabled={selectedToken2Amount == "0"}
                                      >
                                        Max
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                          {selectedTokenDeposit1 && selectedTokenDeposit2 && tokenList2.length == 0 && (
                            <div className="bg-white p-6 rounded-xl shadow-md space-y-8">
                              {/* Header */}
                              <div>
                                <h2 className="text-xl font-semibold text-gray-800">Creating new pool</h2>
                                <p className="text-sm text-gray-500 mt-1">
                                  Your selections will create a new liquidity pool which may result in lower initial liquidity and increased volatility.
                                </p>
                              </div>

                              {/* Initial Price */}
                              <div>
                                <h3 className="text-base font-semibold text-gray-800 mb-1">Set initial price</h3>
                                <p className="text-sm text-gray-500 mb-3">
                                  When creating a new pool, you must set the starting exchange rate for both tokens. This rate will reflect the initial market price.
                                </p>
                                <div className="bg-gray-100 p-4 rounded-lg space-y-2">
                                  <label className="text-sm text-gray-700">Initial price</label>
                                  <div className="flex justify-between items-center">
                                    <input
                                      name="initialPrice"
                                      type="number"
                                      placeholder="0"
                                      value={initialPrice}
                                      onChange={handleInputChange}
                                      className="no-spinner focus:outline-none w-1/2 p-2 rounded-md"
                                    />
                                    <div className="flex items-center gap-1">
                                      <TokenIcon symbol={selectedTokenDeposit1?._symbol || ""} size="md" />
                                      <span className="text-gray-600 font-medium mr-2">{selectedTokenDeposit1?._name || ""}</span>
                                      <TokenIcon symbol={selectedTokenDeposit2?._symbol || ""} size="md" />
                                      <span className="text-gray-600 font-medium">{selectedTokenDeposit2?._name || ""}</span>
                                    </div>
                                  </div>
                                  <span className="text-sm text-gray-500">1 UNI = 1 USDG</span>
                                  <div className="text-xs text-gray-400 mt-2">
                                    ⚠️ Market price not found. Please do your own research to avoid loss of funds.
                                  </div>
                                </div>
                              </div>

                              {/* Deposit Tokens */}
                              <div>
                                <h3 className="text-base font-semibold text-gray-800 mb-1">Deposit tokens</h3>
                                <p className="text-sm text-gray-500 mb-3">Specify the token amounts for your liquidity contribution.</p>

                                {/* Token 1 */}
                                <div className="bg-gray-100 p-3 rounded-lg flex items-center justify-between mb-3">
                                  <input
                                    name="tokenAmount1"
                                    type="number"
                                    placeholder="0"
                                    value={tokenAmount1}
                                    onChange={handleInputChange}
                                    className="no-spinner focus:outline-none w-1/2 p-2 rounded-md"
                                  />
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="w-full flex items-center justify-end gap-2">
                                      <TokenIcon symbol={selectedTokenDeposit1?._symbol || ""} size="md" />
                                      <span className="text-gray-600 font-medium mr-2">{selectedTokenDeposit1?._name || ""}</span>
                                    </div>
                                    <div>
                                      <span>{selectedToken1Amount || 0}</span>
                                      <button className="ml-3 text-xs text-purple-600 font-medium">Max</button>
                                    </div>
                                  </div>
                                </div>

                                {/* Token 2 */}
                                <div className="bg-gray-100 p-3 rounded-lg flex items-center justify-between">
                                  <input
                                    name="tokenAmount2"
                                    type="number"
                                    placeholder="0"
                                    value={tokenAmount2}
                                    onChange={handleInputChange}
                                    className="no-spinner focus:outline-none w-1/2 p-2 rounded-md"
                                  />
                                  <div className="flex flex-col items-center gap-2">
                                    <div className="w-full flex items-center justify-end gap-2">
                                      <TokenIcon symbol={selectedTokenDeposit2?._symbol || ""} size="md" />
                                      <span className="text-gray-600 font-medium mr-2">{selectedTokenDeposit2?._name || ""}</span>
                                    </div>
                                    <div className="flex">
                                      <span>{selectedToken2Amount || 0}</span>
                                      <button className="ml-3 text-xs text-purple-600 font-medium">Max</button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
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
                          disabled={!(depositAmount1 && depositAmount2) ||
                            liquidityLoading}
                        >
                          {liquidityLoading && <Spin />}
                          Add Liquidity
                        </button>
                      </div>
                    </div>
                  </div>

                  {showTokenSelectorDeposit && selectingDepositToken !== 2 && (
                    <TokenDropdown
                      show={showTokenSelectorDeposit}
                      onClose={() => setShowTokenSelectorDeposit(false)}
                      tokenSearchQuery={tokenSearchQueryDeposit1}
                      setTokenSearchQuery={setTokenSearchQueryDeposit1}
                      popularTokens={tokens}
                      handleTokenSelect={handleTokenSelectDeposit}
                    />
                  )}
                  {showTokenSelectorDeposit && selectingDepositToken === 2 && (
                    <TokenDropdown
                      show={showTokenSelectorDeposit}
                      onClose={() => setShowTokenSelectorDeposit(false)}
                      tokenSearchQuery={tokenSearchQueryDeposit2}
                      setTokenSearchQuery={setTokenSearchQueryDeposit2}
                      popularTokens={
                        tokenList2.length > 0
                          ? tokenList2
                          : tokens ? tokens.filter(token => token.address !== selectedTokenDeposit1?.address) : []
                      }
                      handleTokenSelect={handleTokenSelectDeposit}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        {contextHolder}
      </div>
    );
  };
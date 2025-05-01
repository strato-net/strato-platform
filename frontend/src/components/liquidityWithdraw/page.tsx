import TokenIcon from "@/app/icons/TokenIcon";
import { useTokens } from "@/context/TokenContext";
import { TokenData } from "@/interface/token";
import { notification, Spin } from "antd";
import axios from "axios";
import { useEffect, useState } from "react";
import TokenDropdown from "../_dropdown/page";
import { BigNumber } from "bignumber.js"

export const RenderWithdraw = () => {
    // Replace state declarations with new state for LP pools and withdraw info
    const [lpPools, setLpPools] = useState<TokenData[]>([]);
    const [showTokenSelectorWithdraw, setShowTokenSelectorWithdraw] = useState(
      false,
    );
    const [selectedWithdrawPool, setSelectedWithdrawPool] = useState<
      TokenData | null
    >(null);
    const [tokenSearchQueryWithdraw, setTokenSearchQueryWithdraw] = useState(
      "",
    );
    const [withdrawAmount, setWithdrawAmount] = useState<string>("");
    const [api, contextHolder] = notification.useNotification();
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const { tokens } = useTokens();

    // Withdraw handler
    const handleWithdraw = async () => {
      if (!selectedWithdrawPool) return;
      try {
        setWithdrawLoading(true);
        const calculatedAmount = new BigNumber(withdrawAmount.toString())
          .multipliedBy(
            new BigNumber(selectedWithdrawPool?.value || "").dividedBy(
              10 ** 18,
            ),
          ).dividedBy(100);
        const response = await axios.post("/api/swap/removeLiquidity", {
          address: selectedWithdrawPool.address,
          amount: new BigNumber(calculatedAmount).multipliedBy(10 ** 18)
            .toFixed(0),
        });
        console.log("Withdraw response:", response.data);
        api["success"]({
          message: "Success",
          description: `Successfully withdrew ${selectedWithdrawPool?._name}`,
        });
        setWithdrawLoading(false);
      } catch (err) {
        console.error("Withdraw error:", err);
        setWithdrawLoading(false);
        api["error"]({
          message: "Error",
          description: `Withdraw Error - ${err}`,
        });
      }
    };

    // Fetch pools the user has deposited into
    useEffect(() => {
      const fetchUserPools = async () => {
        try {
          const res = await axios.get(`/api/lpToken/`);
          const tempPools = res.data;
          const enrichedPools = tempPools.map(
            (pool: { data: { tokenA: string; tokenB: string } }) => {
              const tokenAInfo = tokens && tokens.find((t) =>
                t.address === pool.data.tokenA
              );
              const tokenBInfo = tokens &&
                tokens.find((t) => t.address === pool.data.tokenB);

              return {
                ...pool,
                _name: `${tokenAInfo?._name}/${tokenBInfo?._name}`,
                _symbol: `${tokenAInfo?._symbol}/${tokenBInfo?._symbol}`,
              };
            },
          );
          console.log(enrichedPools, "pools");
          setLpPools(enrichedPools);
        } catch (err) {
          console.error(err);
        }
      };
      fetchUserPools();
    }, [tokens]);

    const handleChange = (value: string) => {
      if (value === "" || (Number(value) <= 100 && Number(value) >= 0)) {
        setWithdrawAmount(value);
      }
    };

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
                  className="relative flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
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
                <div className="flex justify-center items-center border border-blue-200 rounded-xl">
                  <input
                    type="number"
                    placeholder="0"
                    value={withdrawAmount}
                    onChange={(e) => handleChange(e.target.value)}
                    className="no-spinner w-full p-4  focus:outline-none text-gray-800 placeholder-gray-400" // Right padding for the % sign
                    disabled={!selectedWithdrawPool}
                    max="100"
                    min="0"
                  />
                  <span className="text-gray-900 font-bold pointer-events-none mr-4">
                    %
                  </span>
                </div>
                {selectedWithdrawPool && (
                  <div className="text-sm text-gray-600 mt-1">
                    Max available LP tokens:{" "}
                    {Number(selectedWithdrawPool.value) / 1e18}
                    {" "}
                  </div>
                )}
                {selectedWithdrawPool &&
                  (
                    <div className="w-full flex justify-between px-2">
                      <span>
                        {selectedWithdrawPool?._name?.split("/")[0]} position
                      </span>
                      <span>
                        {new BigNumber(selectedWithdrawPool?.value || 0)
                          .dividedBy(
                            new BigNumber(
                              selectedWithdrawPool?._totalSupply || 1,
                            ),
                          )
                          .multipliedBy(
                            new BigNumber(
                              selectedWithdrawPool?.data?.tokenABalance || 0,
                            ),
                          )
                          .dividedBy(1e18) // multiply by 10^18
                          .toFixed(0)}
                      </span>
                    </div>
                  )}
                {selectedWithdrawPool &&
                  (
                    <div className="w-full flex justify-between px-2">
                      <span>
                        {selectedWithdrawPool?._name?.split("/")[1]} position
                      </span>
                      <span>
                        {new BigNumber(selectedWithdrawPool?.value || 0)
                          .dividedBy(
                            new BigNumber(
                              selectedWithdrawPool?._totalSupply || 1,
                            ),
                          )
                          .multipliedBy(
                            new BigNumber(
                              selectedWithdrawPool?.data?.tokenBBalance || 0,
                            ),
                          )
                          .dividedBy(1e18) // multiply by 10^18
                          .toFixed(0)}
                      </span>
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
              disabled={!(parseFloat(withdrawAmount) > 0 &&
                selectedWithdrawPool) || withdrawLoading}
            >
              {withdrawLoading && <Spin />} Withdraw
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
import TokenIcon from "@/app/icons/TokenIcon";
import { ChildComponentProps, TokenData } from "@/interface/token";
import { notification, Spin } from "antd";
import axios from "axios";
import { useEffect, useState } from "react";
import TokenDropdown from "../_dropdown/page";
import { BigNumber } from "bignumber.js";

export const RenderLendDeposit = ({ dashboardRef }: ChildComponentProps) => {
  const [showDepositTokenSelector, setShowDepositTokenSelector] =
    useState(false);
  const [selectedDepositToken, setSelectedDepositToken] =
    useState<TokenData | null>(null);
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [api, contextHolder] = notification.useNotification();
  const [depositTokenList, setDepositTokenList] = useState<TokenData[]>([]);
  const [selectedDepositTokenBalance, setSelectedDepositTokenBalance] = useState(0)
  const [wrongAmount, setWrongAmount] = useState(false)

  const handleDepositAmountChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;

    if (/^\d*\.?\d*$/.test(value)) {
      if (new BigNumber(parseFloat(value)).isGreaterThan(new BigNumber(selectedDepositTokenBalance).dividedBy(10 ** 18))) {
        setWrongAmount(true)
      } else {
        setWrongAmount(false)
      }
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
      dashboardRef.current?.refresh();
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
    const fetchTokenList = async () => {
      try {
        const res = await axios.get(`/api/depositableTokens`);
        setDepositTokenList(res.data);
        setSelectedDepositToken(res.data[0] || null);
        setSelectedDepositTokenBalance(res.data[0]?.value)
      } catch (err) {
        console.log(err);
      }
    };

    fetchTokenList();
  }, []);

  const handleTokenSelect = (token: TokenData) => {
    setSelectedDepositToken(token);
    setShowDepositTokenSelector(false);
    setSelectedDepositTokenBalance(parseFloat(token?.value ?? "0"));
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
              {selectedDepositToken && <TokenIcon
                symbol={selectedDepositToken?._symbol || "NA"}
                size="md"
              />}
              {selectedDepositToken ?
                <span className="text-[#2C3E50] font-medium">
                  {selectedDepositToken?._name}
                </span> : <>
                  <span className="mr-3">Fetching Tokens </span>  <Spin />
                </>}
            </div>
            {selectedDepositToken && <svg
              className="w-5 h-5 rotate-90 text-blue-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
            </svg>}
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
              className={`flex-1 text-lg focus:outline-none placeholder-gray-400 bg-transparent" ${wrongAmount ? "text-red-500" : "text-gray-800"}`}
            />
            <div className="flex items-center gap-2 ml-3">
              <h3 className="text-base font-semibold text-gray-700">
                {selectedDepositToken?._symbol ?? ""}
              </h3>
            </div>
          </div>
          {wrongAmount && <span className="text-red-500">Entered amount is greater than your current balance.</span>}
        </div>
        <div className="mt-10 w-1/2 mx-auto">
          <button
            className={`flex justify-center gap-3 w-full px-6 py-4 font-semibold rounded-xl transition ${selectedDepositToken && depositAmount && depositAmount !== '0' && !wrongAmount
              ? "cursor-pointer bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white"
              : "cursor-not-allowed bg-gray-300"
              }`}
            disabled={!selectedDepositToken || depositLoading || Number(depositAmount) == 0 || wrongAmount}
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
          popularTokens={depositTokenList}
          handleTokenSelect={handleTokenSelect}
        />
      )}
      {contextHolder}
    </div>
  );
};
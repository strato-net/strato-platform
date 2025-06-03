import TokenIcon from "@/app/icons/TokenIcon";
import { ChildComponentProps, TokenData } from "@/interface/token";
import { notification, Spin } from "antd";
import axios from "axios";
import { ethers } from "ethers";
import { useEffect, useState } from "react";
import TokenDropdown from "../_dropdown/page";

// Extend TokenData interface
interface ExtendedTokenData extends TokenData {
  collateralRatio?: string;
  interestRate?: string;
}

export const RenderBorrow = ({ dashboardRef }: ChildComponentProps) => {
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
  const [collateralAmount, setCollateralAmount] = useState<string>("");
  const [tokenSearchQueryWithdraw, setTokenSearchQueryWithdraw] =
    useState("");
  const [tokenSearchQueryColleteral, setTokenSearchQueryColleteral] =
    useState("");
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [api, contextHolder] = notification.useNotification();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [minCollateral, setMinCollateral] = useState<string>("0");

  useEffect(() => {
    if (!selectedWithdrawToken || !selectedColleteralToken || !withdrawAmount) {
      setMinCollateral("0");
      return;
    }
    try {
      // parse borrow amount to wei
      const amountWei = ethers.parseUnits(withdrawAmount, 18);
      // extract prices and ratio
      const assetPrice = BigInt(selectedWithdrawToken?.price || 0);
      const collateralPrice = BigInt(selectedColleteralToken?.price || 0);
      const ratio = BigInt(Number(selectedColleteralToken?.collateralRatio || 0));
      // calculate min collateral: (amountWei * assetPrice * ratio) / (collateralPrice * 100)
      const minWei = (amountWei * assetPrice * ratio) / (collateralPrice * BigInt(100));
      setMinCollateral(ethers.formatUnits(minWei, 18));
      setCollateralAmount(ethers.formatUnits(minWei, 18));
    } catch {
      setMinCollateral("0");
    }
  }, [withdrawAmount, selectedWithdrawToken, selectedColleteralToken]);

  const handleWithdrawAmountChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setWithdrawAmount(value);
      if (
        selectedWithdrawToken &&
        parseFloat(value) >
        parseFloat(ethers.formatUnits(selectedWithdrawToken?.liquidity || 0, 18))
      ) {
        setErrorMessage("Amount exceeds maximum borrowable amount.");
      } else {
        setErrorMessage("");
      }
    }
  };

  const handleCollateralAmountChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setCollateralAmount(value);
    }
  };

  const borrowLoan = async () => {
    try {
      setBorrowLoading(true);
      // Use ethers.js to parse amounts to wei
      const amountInWei = ethers.parseUnits(withdrawAmount, 18).toString();
      const collateralInWei = ethers
        .parseUnits(collateralAmount, 18)
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
      dashboardRef.current?.refresh();
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
    parseFloat(withdrawAmount) <=
    parseFloat(ethers.formatUnits(selectedWithdrawToken?.liquidity || 0, 18)) &&
    parseFloat(collateralAmount) >= parseFloat(minCollateral) &&
    parseFloat(collateralAmount) <=
    parseFloat(ethers.formatUnits(selectedColleteralToken?.value || 0, 18));

  useEffect(() => {
    const fetchTokenList = async () => {
      try {
        const res = await axios.get(`/api/depositableTokens`);
        setTokens(res.data);
        setSelectedWithdrawToken(res.data[0] || null);
        setSelectedColleteralToken(res.data[1] || null);
      } catch (err) {
        console.log(err);
      }
    };

    fetchTokenList();
  }, []);

  const handleTokenSelect = (token: TokenData) => {
    if (selectingToken === 1) {
      setSelectedWithdrawToken(token as ExtendedTokenData);
      setShowWithdrawTokenSelector(false);
    } else if (selectingToken === 2) {
      setSelectedColleteralToken(token as ExtendedTokenData);
      setShowColleteralTokenSelector(false);
    }
    setSelectingToken(null);
  };

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-10">
      <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
          Borrow Loan
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
              {selectedWithdrawToken && <TokenIcon
                symbol={selectedWithdrawToken?._symbol || "NA"}
                size="md"
              />}
              {selectedWithdrawToken ? <span className="text-gray-800 font-medium">
                {selectedWithdrawToken._name}
              </span> : <>
                <span className="mr-3">Fetching Tokens </span>  <Spin />
              </>}
            </div>
            {selectedWithdrawToken &&
              <svg
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
              value={withdrawAmount}
              onChange={handleWithdrawAmountChange}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder="0.00"
              className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
            />
            {selectedWithdrawToken && <div className="flex items-center gap-2 ml-3">
              <h3 className="text-base font-semibold text-gray-700">
                {selectedWithdrawToken?._symbol ?? "NA"}
              </h3>
            </div>}
          </div>
        </div>
        {selectedWithdrawToken && (
          <p className="mt-2 text-sm text-gray-500">
            {parseFloat(
              ethers.formatUnits(selectedWithdrawToken?.liquidity || 0, 18)
            ).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            {selectedWithdrawToken._symbol} available in pool
          </p>
        )}
        {errorMessage && (
          <p className="mt-1 text-sm text-red-500">{errorMessage}</p>
        )}
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
              {selectedColleteralToken && <TokenIcon
                symbol={selectedColleteralToken?._symbol || ""}
                size="md"
              />}
              {selectedColleteralToken ? <span className="text-gray-800 font-medium">
                {selectedColleteralToken._name}
              </span> : <>
                <span className="mr-3">Fetching Tokens </span>  <Spin />
              </>}
            </div>
            {selectedColleteralToken && <svg
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
            Interest on Loan
          </label>
          <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-gray-50">
            <span className="text-lg text-gray-800">{selectedWithdrawToken?.interestRate ?? 0}%</span>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-blue-700 mb-1">
            Collateralization
          </label>
          <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-gray-50">
            <span className="text-lg text-gray-800">{selectedColleteralToken?.collateralRatio ?? 0}%</span>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-blue-700 mb-1">
            Collateral Amount
          </label>
          <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white">
            <input
              value={collateralAmount}
              onChange={handleCollateralAmountChange}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder="0.00"
              className="flex-1 text-lg focus:outline-none text-gray-800 placeholder-gray-400 bg-transparent"
            />
            {selectedColleteralToken &&
              <div className="flex items-center gap-2 ml-3">
                <h3 className="text-base font-semibold text-gray-700">
                  {selectedColleteralToken?._symbol ?? "NA"}
                </h3>
              </div>}
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Minimum collateral: {minCollateral} {selectedColleteralToken?._symbol || selectedColleteralToken?.address}
            (calculated as (borrow amount × price × collateral ratio) ÷ collateral price)
          </p>
          {collateralAmount && parseFloat(collateralAmount) < parseFloat(minCollateral) && (
            <p className="mt-1 text-sm text-red-500">
              Collateral must be at least {minCollateral} {selectedColleteralToken?._symbol}
            </p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            Available user balance:{" "}
            {parseFloat(
              ethers.formatUnits(selectedColleteralToken?.value || 0, 18)
            ).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            {selectedColleteralToken?._symbol || "NA"}
          </p>
          {/* If they type more than they have, show an error */}
          {collateralAmount &&
            parseFloat(collateralAmount) >
            parseFloat(
              ethers.formatUnits(selectedColleteralToken?.value || 0, 18)
            ) && (
              <p className="mt-1 text-sm text-red-500">
                Collateral cannot exceed{" "}
                {parseFloat(
                  ethers.formatUnits(selectedColleteralToken?.value || 0, 18)
                ).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {selectedColleteralToken?._symbol || "NA"}
              </p>
            )}
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
          popularTokens={tokens.filter(
            (token) =>
              selectedWithdrawToken &&
              token.address !== selectedWithdrawToken.address
          )}
          handleTokenSelect={handleTokenSelect}
        />
      )}
      {contextHolder}
    </div>
  );
};
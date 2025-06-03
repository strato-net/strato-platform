"use client";

import { useState, ChangeEvent, useEffect } from "react";
import TokenDropdown from "@/components/_dropdown/page";
import { TokenData } from "@/interface/token";
import TokenIcon from "../icons/TokenIcon";
import axios from "axios";
import { useUser } from "@/context/UserContext";
import { ethers } from "ethers";

export default function BuyBridge() {
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
  const [listingData, setListingData] = useState<TokenData[] | null>(null);
  const [availablePaymentProviders, setAvailablePaymentProviders] = useState<{ name: string, address: string }[]>([]);
  const { userAddress } = useUser();

  const handleTokenSelect = (token: TokenData) => {
    setSelectedToken(token);
    setAvailablePaymentProviders(
      (token.paymentProviders || [])
        .filter((p: any) => p && typeof p.providerAddress === "string" && typeof p.name === "string")
        .map((p: any) => ({ name: p.name, address: p.providerAddress }))
    );
    setShowTokenSelector(false);
  };

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  };

  const fetchData = async () => {
    try {
      const { data } = await axios.get("/api/onramp");
      const listings = data?.listings;

      if (listings) {
        const arr: TokenData[] = Object.values(listings).map(
          (listing: any) => ({
            _name: listing.tokenName,
            _symbol: listing.tokenSymbol,
            address: listing.token,
            ...listing,
          })
        );
        setListingData(arr);
        console.log("listings data>", arr);
      } else {
        console.warn("No listings found.");
      }
    } catch (error) {
      console.error("Error while getting listings:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleBuy = async () => {
    try {
      const selectedProvider = availablePaymentProviders.find(p => p.name === paymentMethod);
      const payload = {
        listingId: selectedToken?.id,
        amount: ethers.parseUnits(amount, 18).toString(),
        paymentProviderAddress: selectedProvider?.address,
      };

      const headers = {
        address: userAddress,
      };
      // send a POST to lock on-ramp and get the URL in JSON
      const { data } = await axios.post<{ url: string }>(
        "/api/onramp/lock",
        payload,
        { headers }
      );
      const stripeUrl = data.url;
      if (stripeUrl) {
        window.location.href = stripeUrl;
      } else {
        console.error("No URL returned in response:", data);
      }
    } catch (error) {
      console.error("Failed to lock on-ramp amount:", error);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-16 space-y-12">
      <div className="bg-white border border-blue-100 shadow-2xl rounded-3xl p-8 w-full max-w-md space-y-6">
        <h2 className="text-3xl font-bold text-center text-[#1f1f5f]">Buy</h2>

        {/* Asset Dropdown */}
        <div>
          <button
            onClick={() => setShowTokenSelector(true)}
            className="flex items-center justify-between px-4 py-3 border border-gray-300 rounded-xl bg-gray-50 hover:bg-gray-100 w-full transition"
          >
            <div className="flex items-center gap-3">
              {selectedToken && (
                <TokenIcon symbol={selectedToken._symbol || "NA"} size="md" />
              )}
              <span className="text-gray-gray-800 font-medium">
                {ethers.formatUnits(selectedToken?.amount || "0", 18)}{" "}
                {selectedToken?._name || "Select a token"}{" "}
              </span>
            </div>
            <svg
              className="w-5 h-5 rotate-90 text-gray-500"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M15.707 5.293a1 1 0 0 1 0 1.414L10.414 12l5.293 5.293a1 1 0 0 1-1.414 1.414l-6-6a1 1 0 0 1 0-1.414l6-6a1 1 0 0 1 1.414 0z" />
            </svg>
          </button>
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-blue-700 mb-1">
            Amount
          </label>
          <div className="flex items-center border border-blue-200 rounded-xl px-4 py-3 bg-white focus-within:ring-2 focus-within:ring-blue-300 transition">
            <input
              value={amount}
              onChange={handleAmountChange}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*\.?[0-9]*"
              placeholder="0.00"
              className="flex-1 text-lg focus:outline-none text-gray-900 placeholder-gray-400 bg-transparent"
            />
          </div>
          {selectedToken?.tokenOracleValue && amount && (
            <div className="mt-2 text-sm text-gray-600">
              ≈{" "}
              {(
                (Number(selectedToken.tokenOracleValue) / 1e18) *
                Number(amount) *
                (1 + Number(selectedToken.marginBps) / 10000)
              ).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 2,
              })}
            </div>
          )}
        </div>

        {/* Payment Method */}
        <div>
          <label className="block text-sm font-medium text-blue-700 mb-2">
            Payment Method
          </label>
          <div className="flex flex-col gap-2">
            {availablePaymentProviders.map((provider) => (
              <label
                key={provider.address}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="payment"
                  value={provider.name}
                  checked={paymentMethod === provider.name}
                  onChange={() => setPaymentMethod(provider.name)}
                  className="accent-blue-600"
                />
                <span className="text-gray-800 capitalize">{provider.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Buy Button */}
        <button
          type="submit"
          onClick={handleBuy}
          disabled={!amount || !selectedToken || !paymentMethod}
          className={`flex justify-center items-center gap-2 w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 
            ${amount && selectedToken && paymentMethod
              ? "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 cursor-pointer"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
        >
          Buy
        </button>
      </div>

      {showTokenSelector && (
        <TokenDropdown
          show={showTokenSelector}
          onClose={() => setShowTokenSelector(false)}
          tokenSearchQuery={tokenSearchQuery}
          setTokenSearchQuery={setTokenSearchQuery}
          popularTokens={listingData ? listingData : []}
          handleTokenSelect={handleTokenSelect}
        />
      )}
    </div>
  );
}

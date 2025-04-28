"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import TokenDropdown from "@/components/_dropdown/page";
import TokenIcon from "../icons/TokenIcon";
import { TokenData } from "@/interface/token";

const TransferPanel = () => {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState(0);
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);

  useEffect(() => {
    if (!from) {
      axios
        .get("api/users/me")
        .then((response) => {
          localStorage.setItem("user", JSON.stringify(response.data));
          setFrom(response.data.userAddress);
        })
        .catch((error) => {
          console.error("Error fetching user data:", error);
        });
    }
    if (!from) return;
    axios
      .get("api/tokens/table/balance?key=eq." + from)
      .then((response) => {
        console.log(response.data, "response");
        const tokensData = response.data.map((token: any) => ({
          _name: token["BlockApps-Mercata-ERC20"]._name,
          _symbol: token["BlockApps-Mercata-ERC20"]._symbol,
          address: token.address,
          value: token.value,
        }));
        setTokens(tokensData);
        setSelectedToken(tokensData[0]);
      })
      .catch((error) => {
        console.error("Error fetching tokens:", error);
      });
  }, [from]);

  const handleTokenSelect = (token: TokenData) => {
    setSelectedToken(token);
    setShowTokenSelector(false);
  };
  console.log(selectedToken, "selectedToken");

  const isFormValid = from && to && selectedToken && amount > 0;

  const handleTransfer = () => {
    axios.post("api/tokens/transfer", {
      address: selectedToken?.address,
      to,
      value: (amount * 1e18).toFixed(0),
    });
  };

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-30">
      <div className="bg-white rounded-3xl shadow-xl border border-blue-100 p-8 w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-[#1f1f5f] mb-8">
          Transfer Token
        </h2>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Transfer from
            </label>
            <input
              type="text"
              placeholder="0xYourAddress"
              disabled={true}
              value={from}
              className="bg-gray w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Transfer to
            </label>
            <input
              type="text"
              placeholder="0xRecipientAddress"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-4 py-3 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 placeholder-gray-400"
            />
          </div>

          <div>
            <button
              onClick={() => {
                setShowTokenSelector(true);
              }}
              className="flex items-center justify-between px-4 py-3 border rounded-xl border-gray-300 bg-gray-100 w-full"
            >
              <div className="flex items-center gap-2">
                <TokenIcon symbol={selectedToken?._symbol || "NA"} size="md" />
                <span className="text-gray-800 font-medium">
                  {selectedToken ? selectedToken._name : "ETH"}
                  {" ("}
                  {selectedToken ? Number(selectedToken?.value) / 1e18 : 0}
                  {")"}
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

          <div>
            <label className="block text-sm font-medium text-blue-700 mb-1">
              Amount
            </label>
            <input
              type="number"
              placeholder="e.g. 0.05"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full px-4 py-3 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 placeholder-gray-400"
            />
          </div>

          <button
            type="button"
            disabled={!isFormValid}
            onClick={handleTransfer}
            className={`w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 ${
              isFormValid
                ? "bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            Transfer
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

export default TransferPanel;

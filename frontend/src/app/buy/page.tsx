"use client";

import { useState, ChangeEvent } from "react";
import TokenDropdown from "@/components/_dropdown/page";
import { useTokens } from "@/context/TokenContext";
import { TokenData, TokenForm } from "@/interface/token";
import TokenIcon from "../icons/TokenIcon";

export default function BuyBridge() {
    const [paymentMethod, setPaymentMethod] = useState<"credit_card" | "ACH">("credit_card");
    const [tokenSearchQuery, setTokenSearchQuery] = useState("");
    const [amount, setAmount] = useState<string>("");
    const [showTokenSelector, setShowTokenSelector] = useState(false);
    const [selectedToken, setSelectedToken] = useState<TokenData | null>(null);
    const { tokens } = useTokens();

    const handleSubmit = () => {
        console.log(paymentMethod, selectedToken?._name, amount, "data");
    };

    const handleTokenSelect = (token: TokenData) => {
        setSelectedToken(token);
        setShowTokenSelector(false);
    };

    const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (/^\d*\.?\d*$/.test(value)) {
            setAmount(value);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white via-blue-50 to-blue-100 px-4 py-16 space-y-12">
            <div className="bg-white border border-blue-100 shadow-2xl rounded-3xl p-8 w-full max-w-md space-y-6">
                <h2 className="text-3xl font-bold text-center text-[#1f1f5f]">
                    Buy or Bridge Token
                </h2>

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
                            <span className="text-gray-800 font-medium">
                                {selectedToken && amount && `${Number(amount) * 1.5}    `}
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
                </div>

                {/* Payment Method */}
                <div>
                    <label className="block text-sm font-medium text-blue-700 mb-2">
                        Payment Method
                    </label>
                    <div className="flex gap-4">
                        {(["credit_card", "ACH"] as const).map((method) => (
                            <label key={method} className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="payment"
                                    value={method}
                                    checked={paymentMethod === method}
                                    onChange={() => setPaymentMethod(method)}
                                    className="accent-blue-600"
                                />
                                <span className="text-gray-800 capitalize">
                                    {method.replace("_", " ")}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                {/* Buy Button */}
                <button
                    type="submit"
                    onClick={handleSubmit}
                    disabled={!amount || !selectedToken}
                    className={`flex justify-center items-center gap-2 w-full font-semibold py-3 px-4 rounded-xl transition-all duration-300 
                        ${amount && selectedToken
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
                    popularTokens={tokens}
                    handleTokenSelect={handleTokenSelect}
                />
            )}
        </div>
    );
}

"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { FaHandHoldingUsd } from 'react-icons/fa';
import { IoMdSwap } from "react-icons/io";
import { FaMoneyBillTransfer } from "react-icons/fa6";
import { MdAttachMoney } from "react-icons/md";
import Image from "next/image";

type Token = {
  id: number;
  name: string;
  symbol: string;
  balance: string;
  value: string;
  change24h: string;
  icon: string;
};

type Transaction = {
  id: number;
  type: "Swap" | "Lend";
  from?: string;
  to?: string;
  token?: string;
  amount: string;
  value: string;
  date: string;
};

const userTokens: Token[] = [
  {
    id: 1,
    name: "Ethereum",
    symbol: "ETH",
    balance: "2.5",
    value: "$4,500",
    change24h: "+2.5%",
    icon: "/icons/eth.svg"
  },
  {
    id: 2,
    name: "USD Coin",
    symbol: "USDC",
    balance: "1,000",
    value: "$1,000",
    change24h: "0%",
    icon: "/icons/usdc.svg"
  },
  {
    id: 3,
    name: "Dai",
    symbol: "DAI",
    balance: "500",
    value: "$500",
    change24h: "-0.1%",
    icon: "/icons/dai.svg"
  }
];

const recentTransactions: Transaction[] = [
  {
    id: 1,
    type: "Swap",
    from: "ETH",
    to: "USDC",
    amount: "0.5 ETH",
    value: "$900",
    date: "2024-03-15"
  },
  {
    id: 2,
    type: "Lend",
    token: "DAI",
    amount: "200 DAI",
    value: "$200",
    date: "2024-03-14"
  }
];

export default function Dashboard() {
  const router = useRouter();
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);

  const openTokenDetails = (token: Token) => setSelectedToken(token);
  const closeModal = () => setSelectedToken(null);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800">Dashboard</h1>
        </header>

        {/* Portfolio Overview */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white shadow rounded p-6">
            <h3 className="text-sm text-gray-500 mb-2">Total Portfolio Value</h3>
            <p className="text-2xl font-bold text-gray-800">$6,000</p>
            <p className="text-sm text-green-600">+2.5% (24h)</p>
          </div>
          <div className="bg-white shadow rounded p-6">
            <h3 className="text-sm text-gray-500 mb-2">Total Tokens</h3>
            <p className="text-2xl font-bold text-gray-800">{userTokens.length}</p>
          </div>
          <div className="bg-white shadow rounded p-6">
            <h3 className="text-sm text-gray-500 mb-2">Recent Transactions</h3>
            <p className="text-2xl font-bold text-gray-800">{recentTransactions.length}</p>
          </div>
        </section>

        {/* Action Buttons Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <button
            disabled
            className="cursor-not-allowed flex flex-col items-center justify-center gap-2 bg-white shadow rounded p-6 hover:bg-gray-50 transition cursor-not-allowed"
          >
            <MdAttachMoney className="w-8 h-8 text-blue-600" />
            <span className="text-gray-800 font-medium">Buy/Bridge</span>
          </button>
          <button
            onClick={() => router.push("/swap")}
            className="flex flex-col items-center justify-center gap-2 bg-white shadow rounded p-6 hover:bg-gray-50 transition cursor-pointer"
          >
            <IoMdSwap className="w-8 h-8 text-purple-600" />
            <span className="text-gray-800 font-medium">Swap</span>
          </button>
          <button
            onClick={() => router.push("/deposits")}
            className="flex flex-col items-center justify-center gap-2 bg-white shadow rounded p-6 hover:bg-gray-50 transition cursor-pointer"
          >
            <FaHandHoldingUsd className="w-8 h-8 text-green-600" />
            <span className="text-gray-800 font-medium">Lend/Borrow</span>
          </button>
          <button
            onClick={() => router.push("/transfer")}
            className="flex flex-col items-center justify-center gap-2 bg-white shadow rounded p-6 hover:bg-gray-50 transition cursor-pointer"
          >
            <FaMoneyBillTransfer className="w-8 h-8 text-orange-600" />
            <span className="text-gray-800 font-medium">Transfer</span>
          </button>
        </section>

        {/* User Tokens Table */}
        <section className="bg-white shadow-md rounded p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">My Portfolio</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 text-gray-600 text-sm">
                <tr>
                  <th className="py-3 px-4">Token</th>
                  <th className="py-3 px-4">Balance</th>
                  <th className="py-3 px-4">Value</th>
                  <th className="py-3 px-4">24h Change</th>
                  <th className="py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userTokens.map((token) => (
                  <tr key={token.id} className="border-t border-gray-200">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Image width={24} height={24} src={token.icon} alt={token.name} className="w-6 h-6" />
                        <div>
                          <p className="font-medium">{token.name}</p>
                          <p className="text-sm text-gray-500">{token.symbol}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">{token.balance}</td>
                    <td className="py-3 px-4">{token.value}</td>
                    <td className={`py-3 px-4 ${token.change24h.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                      {token.change24h}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => openTokenDetails(token)}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recent Transactions */}
        <section className="bg-white shadow-md rounded p-6">
          <h2 className="text-xl font-semibold text-gray-700 mb-6">Recent Transactions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100 text-gray-600 text-sm">
                <tr>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Value</th>
                  <th className="py-3 px-4">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-gray-200">
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-sm ${
                        tx.type === 'Swap' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {tx.type === 'Swap' ? `${tx.from} → ${tx.to}` : tx.token}
                    </td>
                    <td className="py-3 px-4">{tx.amount}</td>
                    <td className="py-3 px-4">{tx.value}</td>
                    <td className="py-3 px-4">{tx.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Token Details Modal */}
        {selectedToken && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white rounded shadow-lg p-6 w-96 space-y-4">
              <div className="flex items-center gap-3 mb-4">
                <Image width={32} height={32} src={selectedToken.icon} alt={selectedToken.name} className="w-8 h-8" />
                <h3 className="text-lg font-semibold text-gray-800">{selectedToken.name}</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Balance</span>
                  <span className="font-medium">{selectedToken.balance}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Value</span>
                  <span className="font-medium">{selectedToken.value}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">24h Change</span>
                  <span className={`font-medium ${selectedToken.change24h.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedToken.change24h}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    closeModal();
                    router.push("/swap");
                  }}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                >
                  Swap
                </button>
                <button
                  onClick={() => {
                    closeModal();
                    router.push("/lend");
                  }}
                  className="flex-1 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                >
                  Lend
                </button>
              </div>
              <button
                onClick={closeModal}
                className="w-full mt-2 bg-gray-100 text-gray-700 px-4 py-2 rounded hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FaHandHoldingUsd } from 'react-icons/fa';
import { IoMdSwap } from "react-icons/io";
import { FaMoneyBillTransfer } from "react-icons/fa6";
import { MdAttachMoney } from "react-icons/md";
import { CopyOutlined } from '@ant-design/icons';
import { useTokens } from "@/context/TokenContext";
import TokenIcon from "../icons/TokenIcon";
import BigNumber from "bignumber.js";

type Token = {
  id: number;
  name: string;
  symbol: string;
  balance: string;
  value: string;
  change24h: string;
  icon: string;
  address?: string;
};

export default function Dashboard() {
  const router = useRouter();
  const { tokens} = useTokens();
  const [isLoading, setIsLoading] = useState(true);
  const [userTokens, setUserTokens] = useState<Token[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  // const openTokenDetails = (token: Token) => setSelectedToken(token);
  // Calculate pagination values
  const totalPages = Math.ceil(userTokens.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentTokens = userTokens.slice(startIndex, endIndex);

  const fetchUserTokens = useCallback(async () => {
    setIsLoading(true);
    try {
      const userData = JSON.parse(localStorage.getItem('user') || '{}');
      const userAddress = userData.userAddress;
      if (!userAddress) {
        console.log('No user address found');
        setUserTokens([]);
        setIsLoading(false);
        return;
      }
        
      const response = await fetch(`/api/tokens/table/balance?key=eq.${userAddress}`);
      if (!response.ok) {
        throw new Error('Failed to fetch token balances');
      }

      const data = await response.json();
      if (data && Array.isArray(data) && data.length > 0) {
        const formattedTokens = data.map((token: Token) => {
          const matchingToken = tokens?.find(t => t.address === token.address);
          return {
            id: token.id || Math.random(),
            name: matchingToken?._name || token.name || 'Unknown Token',
            symbol: matchingToken?._symbol || token.symbol || 'UNK',
            balance: token.value ? new BigNumber(token.value).dividedBy(10 ** 18).toString() : '0',
            value: token.value ? new BigNumber(token.value).dividedBy(10 ** 18).toString() : '0',
            change24h: token.change24h || '0%',
            icon: token.icon || '/icons/default-token.svg',
            address: token.address
          };
        });
        
        setUserTokens(formattedTokens);
      } else {
        setUserTokens([]);
      }
    } catch (error) {
      console.error('Error fetching token balances:', error);
      setUserTokens([]);
    } finally {
      setIsLoading(false);
    }
  },[tokens]);

  useEffect(() => {
    if (tokens) { 
      fetchUserTokens();
    }
  }, [tokens,fetchUserTokens]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800">Dashboard</h1>
        </header>

        {/* Portfolio Overview */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white shadow rounded p-6">
            <h3 className="text-sm text-gray-500 mb-2">Total Tokens</h3>
            {isLoading ? (
              <div className="animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/4"></div>
              </div>
            ) : (
              <p className="text-2xl font-bold text-gray-800">{userTokens.length}</p>
            )}
          </div>
        </section>

        {/* Action Buttons Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <button
            onClick={() => router.push("/buy")}
            className="flex flex-col items-center justify-center gap-2 bg-white shadow rounded p-6 hover:bg-gray-50 transition cursor-pointer"
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
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, index) => (
                  <div key={index} className="animate-pulse">
                    <div className="flex items-center justify-between py-4">
                      <div className="flex items-center space-x-4">
                        <div className="h-10 w-10 bg-gray-200 rounded-full"></div>
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-24"></div>
                          <div className="h-3 bg-gray-200 rounded w-16"></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-48"></div>
                        <div className="h-4 bg-gray-200 rounded w-8"></div>
                      </div>
                      <div className="h-4 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : userTokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="text-gray-400 mb-4">
                  <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Tokens Found</h3>
                <p className="text-gray-500 text-center mb-4">{"You don't have any tokens in your portfolio yet."}</p>
              </div>
            ) : (
              <>
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100 text-gray-600 text-sm">
                    <tr>
                      <th className="py-3 px-4">Token</th>
                      <th className="py-3 px-4">Token Address</th>
                      <th className="py-3 px-4">Balance</th>
                      {/* <th className="py-3 px-4">Value</th> */}
                      {/* <th className="py-3 px-4">24h Change</th>
                      <th className="py-3 px-4">Actions</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {currentTokens.map((token) => (
                      <tr key={token.id} className="border-t border-gray-200">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <TokenIcon symbol={token.symbol} size="md" />
                            <div>
                              <p className="font-medium text-gray-500">{token.name}</p>
                              <p className="text-sm text-gray-500">{token.symbol}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">{token.address}</span>
                            <div className="relative group">
                              <CopyOutlined 
                                className="cursor-pointer text-gray-500 hover:text-blue-500 transition-colors" 
                                onClick={() => {
                                  navigator.clipboard.writeText(token.address || '');
                                  const tooltip = document.getElementById(`tooltip-${token.id}`);
                                  if (tooltip) {
                                    tooltip.textContent = 'Copied!';
                                    setTimeout(() => {
                                      tooltip.textContent = 'Click to copy';
                                    }, 2000);
                                  }
                                }}
                              />
                              <span 
                                id={`tooltip-${token.id}`}
                                className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-sm px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                              >
                                Click to copy
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-gray-500">{token.balance}</td>
                        {/* <td className="py-3 px-4">{token.value}</td> */}
                        {/* <td className={`py-3 px-4 ${token.change24h.startsWith('+') ? 'text-green-600' : 'text-red-600'}`}>
                          {token.change24h}
                        </td> */}
                        {/* <td className="py-3 px-4">
                          <button
                            onClick={() => openTokenDetails(token)}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            Details
                          </button>
                        </td> */}
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-4">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-gray-600">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
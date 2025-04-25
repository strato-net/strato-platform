"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Lend() {
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  return (
    <div className="h-screen">
      {supplyOpen && <SupplyModal onClose={() => setSupplyOpen(false)} />}
      {withdrawOpen && <WithdrawModal onClose={() => setWithdrawOpen(false)} />}
      <div className="max-w-6xl mx-auto mt-10 p-6 bg-white rounded mt-4 bg-white text-[#303549] shadow-[0_2px_1px_rgba(0,0,0,0.05),0_0_1px_rgba(0,0,0,0.25)] transition-shadow duration-300 ease-in-out rounded border border-[#eaebef]">
        <div className="p-4">
          <div className="mb-2">
            <h3 className="text-xl font-semibold">Your supplies</h3>
          </div>
        </div>
        <div className="h-4"></div>
        <div className="px-4 pb-4">
          <div>
            <p className="text-gray-600">Nothing supplied yet</p>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto mt-10 p-6 bg-white rounded max-w-6xl mx-auto mt-10 p-6 bg-white rounded mt-4 bg-white text-[#303549] shadow-[0_2px_1px_rgba(0,0,0,0.05),0_0_1px_rgba(0,0,0,0.25)] transition-shadow duration-300 ease-in-out rounded border border-[#eaebef]">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-semibold">Assets to supply</h3>
          <button className="text-sm text-blue-600 hover:underline">
            Hide
          </button>
        </div>

        <div className="mb-4">
          <div className="flex items-center bg-blue-100 text-blue-800 p-4 rounded">
            <svg
              className="w-6 h-6 mr-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <span>
              Your Ethereum wallet is empty. Purchase or transfer assets.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-x-2 text-sm font-medium border-b border-gray-200 pb-2 mb-4 select-none">
          <div className="grid grid-cols-4 gap-x-2 text-sm font-medium border-gray-200 pb-2 select-none">
            <div className="flex items-center space-x-1 cursor-pointer group">
              <span>Assets</span>
              <div className="flex flex-col text-gray-400 group-hover:text-gray-600">
                <svg
                  className="w-3 h-3 -mt-1"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.816 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                  />
                </svg>
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.184l3.71-3.954a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1 cursor-pointer group justify-start">
            <span>Wallet balance</span>
            <div className="flex flex-col text-gray-400 group-hover:text-gray-600">
              <svg
                className="w-3 h-3 -mt-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.816 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                  clip-rule="evenodd"
                />
              </svg>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.184l3.71-3.954a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </div>

          <div className="flex items-center space-x-1 cursor-pointer group justify-start">
            <span>APY</span>
            <div className="flex flex-col text-gray-400 group-hover:text-gray-600">
              <svg
                className="w-3 h-3 -mt-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.816 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                  clip-rule="evenodd"
                />
              </svg>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.184l3.71-3.954a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </div>

          <div className="flex items-center space-x-1 cursor-pointer group justify-start">
            <span>Can be collateral</span>
            <div className="flex flex-col text-gray-400 group-hover:text-gray-600">
              <svg
                className="w-3 h-3 -mt-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.816 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                  clip-rule="evenodd"
                />
              </svg>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.184l3.71-3.954a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </div>
          <div className="invisible flex items-center space-x-1 cursor-pointer group justify-start">
            <span></span>
            <div className="flex flex-col text-gray-400 group-hover:text-gray-600">
              <svg
                className="w-3 h-3 -mt-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.816 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                  clip-rule="evenodd"
                />
              </svg>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.184l3.71-3.954a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-x-2 items-center p-4 text-sm">
          <div className="flex items-center space-x-2">
            <img src="/icons/tokens/eth.svg" alt="ETH" className="w-6 h-6" />
            <a href="#" className="font-medium text-gray-700 hover:underline">
              ETH
            </a>
          </div>
          <div className="text-gray-600">0</div>
          <div className="text-gray-600">2.02%</div>
          <div className="flex items-center space-x-2">
            <svg
              className="w-5 h-5 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <div className="flex space-x-2">
              <button
                onClick={() => setSupplyOpen(true)}
                className="px-3 py-1 bg-blue-500 text-white text-sm rounded"
              >
                Supply
              </button>
              <button
                onClick={() => setWithdrawOpen(true)}
                className="px-3 py-1 border border-blue-500 text-blue-500 text-sm rounded"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const SupplyModal = ({ onClose }: any) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="relative p-2 max-w-md mx-auto">
      <div className="text-right absolute top-[2rem] right-[2.2rem]">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <svg
            className="w-5 h-5 inline"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div className="bg-white rounded-md shadow p-6 max-w-md mx-auto">
        <h2 className="text-2xl font-semibold mb-4">Withdraw USDT</h2>

        <div
          className="flex items-start bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
          role="alert"
        >
          <div className="flex-1">
            <p>
              Please switch to Ethereum Sepolia.
              <button type="button" className="text-blue-600 underline ml-2">
                Switch Network
              </button>
            </p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Amount
          </label>
          <div className="flex items-center border border-gray-300 rounded px-3 py-2">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 text-lg focus:outline-none"
            />
            <div className="flex items-center gap-1 ml-3">
              <img
                src="/icons/tokens/usdt.svg"
                alt="USDT icon"
                className="w-6 h-6"
              />
              <h3 className="text-base font-semibold">USDT</h3>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 text-sm text-gray-500">
            <span>$0</span>
            <div className="flex items-center gap-2">
              <span>Supply balance</span>
              <span className="font-medium text-gray-800">10.56K</span>
              <button type="button" className="text-blue-600 underline text-sm">
                Max
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Transaction overview
          </p>
          <div className="flex">
            <div className="px-3 py-2 border border-[#eaebef] rounded-[6px] flex justify-between text-sm mb-2">
              <span>Supply APY</span>
              <span className="text-gray-800">
                10,560.30 <span className="text-gray-500">USDT</span>
              </span>
            </div>
            <div className="px-3 py-2 border border-[#eaebef] rounded-[6px] flex justify-between text-sm mb-2">
              <span>Supply APY</span>
              <span className="text-gray-800">
                10,560.30 <span className="text-gray-500">USDT</span>
              </span>
            </div>
          </div>

          <div className="mb-6 mt-6 flex items-center text-sm text-gray-600">
            <svg
              className="w-5 h-5 text-blue-500 mr-2"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M19.77 7.23l-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77M12 10H6V5h6zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"
                fill="currentColor"
              />
            </svg>
            <span>-</span>
          </div>
        </div>

        <div className="mb-4">
          <button
            type="button"
            className="w-full bg-gray-300 text-gray-600 font-semibold py-2 px-4 rounded cursor-not-allowed"
            disabled
          >
            Wrong Network
          </button>
        </div>

      </div>
    </div>
  </div>
);

export const WithdrawModal = ({ onClose }: any) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="relative p-2 max-w-md mx-auto">
      <div className="text-right absolute top-[2rem] right-[2.2rem]">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <svg
            className="w-5 h-5 inline"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div className="bg-white rounded-md shadow p-6 max-w-md mx-auto">
        <h2 className="text-2xl font-semibold mb-4">Withdraw USDT</h2>

        <div
          className="flex items-start bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4"
          role="alert"
        >
          <div className="flex-1">
            <p>
              Please switch to Ethereum Sepolia.
              <button type="button" className="text-blue-600 underline ml-2">
                Switch Network
              </button>
            </p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Amount
          </label>
          <div className="flex items-center border border-gray-300 rounded px-3 py-2">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 text-lg focus:outline-none"
            />
            <div className="flex items-center gap-1 ml-3">
              <img
                src="/icons/tokens/usdt.svg"
                alt="USDT icon"
                className="w-6 h-6"
              />
              <h3 className="text-base font-semibold">USDT</h3>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2 text-sm text-gray-500">
            <span>$0</span>
            <div className="flex items-center gap-2">
              <span>Supply balance</span>
              <span className="font-medium text-gray-800">10.56K</span>
              <button type="button" className="text-blue-600 underline text-sm">
                Max
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Transaction overview
          </p>
          <div className="px-3 py-2 border border-[#eaebef] rounded-[6px] flex justify-between text-sm mb-2">
            <span>Remaining supply</span>
            <span className="text-gray-800">
              10,560.30 <span className="text-gray-500">USDT</span>
            </span>
          </div>

          <div className="mb-6 mt-6 flex items-center text-sm text-gray-600">
            <svg
              className="w-5 h-5 text-blue-500 mr-2"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M19.77 7.23l-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77M12 10H6V5h6zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1"
                fill="currentColor"
              />
            </svg>
            <span>-</span>
          </div>
        </div>

        <div className="mb-4">
          <button
            type="button"
            className="w-full bg-gray-300 text-gray-600 font-semibold py-2 px-4 rounded cursor-not-allowed"
            disabled
          >
            Wrong Network
          </button>
        </div>

      </div>
    </div>
  </div>
);

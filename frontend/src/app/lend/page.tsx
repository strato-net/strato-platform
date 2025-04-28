"use client";

import SupplyModal from "@/components/_supplyModal/page";
import WithdrawModal from "@/components/_withdrawModal/page";
import Image from "next/image";
import React, { useState } from "react";

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
            <Image src="/icons/tokens/eth.svg" alt="ETH" className="w-6 h-6" />
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

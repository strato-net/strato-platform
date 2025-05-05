import React, { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { ethers } from "ethers";
import { EnrichedLoan, LoanEntry } from "@/interface/token";

export interface DashboardHandle {
  refresh: () => void;
}

const SupplyBorrowDashboard = forwardRef<DashboardHandle>((props, ref) => {
  const [loans, setLoans] = useState<LoanEntry[]>([]);
  const [withdrawables, setWithdrawables] = useState<EnrichedLoan[]>([]);
  const fetchLoans = async () => {
    try {
      const res = await fetch("/api/loans");
      if (!res.ok) throw new Error("Network response was not ok");
      const data = await res.json();
      setLoans(data.loans ? Object.values(data.loans) : []);
    } catch (err) {
      console.error("Failed to fetch loans:", err);
    }
  };
  const fetchWithdrawables = async () => {
    try {
      const res = await fetch("/api/withdrawableTokens");
      if (!res.ok) throw new Error("Network response was not ok");
      const data = await res.json();
      setWithdrawables(data);
    } catch (err) {
      console.error("Failed to fetch withdrawable tokens:", err);
    }
  };

  useEffect(() => {
    fetchLoans();
    fetchWithdrawables();
  }, []);

  useImperativeHandle(ref, () => ({
    refresh: async () => {
      fetchLoans();
      fetchWithdrawables();
    },
  }));

  const activeLoans = loans.filter((loan) => loan.active);

  return (
    <div className="w-full bg-[#f3f4f6] px-6 py-10">
      <div className="max-w-screen-2xl mx-auto w-full space-y-8">
        {/* Supplies and Borrows */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Supplies */}
          <div className="bg-white rounded-2xl shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Your deposits
            </h2>
            {withdrawables.length === 0 ? (
              <p className="text-gray-500">Nothing supplied yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-gray-500 border-b">
                    <tr>
                      <th className="py-2">Asset</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    {withdrawables.map((token, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="py-3">
                          {token._symbol || token.address}
                        </td>
                        <td>{token.value && ethers.formatEther(token.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Borrows */}
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Your loans
              </h2>
            </div>
            {activeLoans.length === 0 ? (
              <p className="text-gray-500">Nothing borrowed yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-gray-500 border-b">
                    <tr>
                      <th className="py-2">Asset</th>
                      <th>Amount</th>
                      <th>Collateral</th>
                      <th>Accrued Interest</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    {activeLoans.map((loan, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="py-3">{loan.assetName || loan.asset}</td>
                        <td>{ethers.formatEther(loan?.amount || 0)}</td>
                        <td>
                          {loan.collateralName || loan.collateralAsset}{" "}
                          {ethers.formatEther(loan?.collateralAmount || 0)}
                        </td>
                        <td>{ethers.formatEther(loan?.interest || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Assets Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assets to Supply */}
          {/* <div className="bg-white rounded-2xl shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Assets to supply
              </h2>
              <button className="text-sm text-gray-500">Hide —</button>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <input type="checkbox" />
              <label>Show assets with 0 balance</label>
              <a href="#" className="ml-auto text-blue-500 text-xs">
                ETHEREUM SEPOLIA FAUCET
              </a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-500 border-b">
                  <tr>
                    <th className="py-2">Assets</th>
                    <th>Wallet balance</th>
                    <th>APY</th>
                    <th>Collateral</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  {[
                    {
                      icon: "₿",
                      name: "WBTC",
                      balance: "2.00",
                      apy: "< 0.01%",
                      collateral: true,
                    },
                    {
                      icon: "🟢",
                      name: "USDT",
                      balance: "30,000.00",
                      apy: "77.28%",
                      collateral: "Isolated",
                    },
                    {
                      icon: "🔵",
                      name: "USDC",
                      balance: "20,000.00",
                      apy: "0.30%",
                      collateral: true,
                    },
                    {
                      icon: "⬛",
                      name: "ETH",
                      balance: "0.2949031",
                      apy: "0%",
                      collateral: true,
                    },
                  ].map((item, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="py-3 flex items-center gap-2">
                        {item.icon} {item.name}
                      </td>
                      <td>{item.balance}</td>
                      <td>{item.apy}</td>
                      <td>
                        {item.collateral === true ? (
                          "✔️"
                        ) : (
                          <span className="bg-orange-100 text-orange-500 px-2 py-0.5 rounded text-xs">
                            Isolated
                          </span>
                        )}
                        3
                      </td>
                      <td>
                        <button className="bg-gray-800 text-white px-3 py-1 rounded">
                          Supply
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div> */}

          {/* Assets to Borrow */}
          {/* <div className="bg-white rounded-2xl shadow p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                Assets to borrow
              </h2>
              <button className="text-sm text-gray-500">Hide —</button>
            </div>

            <div className="bg-blue-50 text-blue-600 p-3 rounded-md text-sm mb-4">
              To borrow you need to supply any asset to be used as collateral.
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-500 border-b">
                  <tr>
                    <th>Asset</th>
                    <th>Available</th>
                    <th>APY, variable</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  {[
                    {
                      icon: "🟣",
                      name: "GHO",
                      available: "0",
                      apy: "1.41 - 2.02%",
                    },
                    { icon: "₿", name: "WBTC", available: "0", apy: "0.05%" },
                    { icon: "🟢", name: "USDT", available: "0", apy: "89.02%" },
                    { icon: "🔵", name: "USDC", available: "0", apy: "1.22%" },
                    { icon: "🟡", name: "DAI", available: "0", apy: "0.37%" },
                    { icon: "🔷", name: "LINK", available: "0", apy: "40.18%" },
                  ].map((item, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="py-3 flex items-center gap-2">
                        {item.icon} {item.name}
                      </td>
                      <td>{item.available}</td>
                      <td>{item.apy}</td>
                      <td className="flex gap-2">
                        <button
                          className="bg-gray-200 text-gray-500 px-3 py-1 rounded cursor-not-allowed"
                          disabled
                        >
                          Borrow
                        </button>
                        <button className="bg-gray-100 text-gray-800 px-3 py-1 rounded border border-gray-300">
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div> */}
        </div>
      </div>
    </div>
  );
});

SupplyBorrowDashboard.displayName = "SupplyBorrowDashboard"; // 👈 Add this line

export default SupplyBorrowDashboard;

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
      </div>
    </div>
  );
});

SupplyBorrowDashboard.displayName = "SupplyBorrowDashboard"; // 👈 Add this line

export default SupplyBorrowDashboard;

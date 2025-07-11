import React from "react";
import { Button } from "@/components/ui/button";
import CopyButton from "../ui/copy";
import { useLiquidationContext } from "@/context/LiquidationContext";
import LiquidateModal from "./LiquidateModal";

const shorten = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);
const weiToEther = (v?: string) => {
  if (!v) return 0;
  try {
    return Number(BigInt(v)) / 1e18;
  } catch {
    return 0;
  }
};

const LiquidationsSection: React.FC = () => {
  const { liquidatable, loading, error, refreshData } = useLiquidationContext();

  const [modalData, setModalData] = React.useState<{
    loan: any;
    collateral: any;
  } | null>(null);

  const openModal = (loan: any, collateral: any) => setModalData({ loan, collateral });
  const closeModal = () => setModalData(null);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div>
      <h3 className="font-semibold mb-2">Liquidatable Positions</h3>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="space-y-4">
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <table className="min-w-full text-left border">
              <thead className="bg-gray-100 text-xs uppercase">
                <tr>
                  <th className="w-8" />
                  <th className="px-4 py-2">Borrower</th>
                  <th className="px-4 py-2">Borrowed</th>
                  <th className="px-4 py-2">Health Factor</th>
                </tr>
              </thead>
              <tbody>
                {liquidatable.map((ln: any) => (
                  <React.Fragment key={ln.id}>
                    <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => toggle(ln.id)}>
                      <td className="text-center">{expanded[ln.id] ? "▾" : "▸"}</td>
                      <td className="px-4 py-2 text-sm flex items-center space-x-2">
                        <span>{shorten(ln.user)}</span>
                        <CopyButton address={ln.user} />
                      </td>
                      <td className="px-4 py-2 text-sm">{weiToEther(ln.amount).toFixed(2)} {ln.assetSymbol}</td>
                      <td className="px-4 py-2 text-sm font-medium {ln.healthFactor < 1 ? 'text-red-600':'text-yellow-600'}">
                        {(ln.healthFactor * 100).toFixed(2)}%
                      </td>
                    </tr>
                    {expanded[ln.id] && (
                      <tr className="border-t">
                        <td colSpan={4} className="p-0 bg-gray-50">
                          <table className="min-w-full text-left">
                            <thead className="bg-gray-100 text-xs uppercase">
                              <tr>
                                <th className="px-4 py-2">Collateral Asset</th>
                                <th className="px-4 py-2">Amount</th>
                                <th className="px-4 py-2">Value (USD)</th>
                                <th className="px-4 py-2">Expected Profit</th>
                                <th className="px-4 py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ln.collaterals.map((c: any, idx: number) => {
                                const usdVal = weiToEther(c.usdValue).toFixed(2);
                                const profitNum = Number(BigInt(c.expectedProfit)) / 1e18;
                                const positive = profitNum > 0;
                                const profit = profitNum.toFixed(2);
                                return (
                                  <tr key={idx} className="border-t">
                                    <td className="px-4 py-2 text-sm">{c.symbol || shorten(c.asset)}</td>
                                    <td className="px-4 py-2 text-sm">{weiToEther(c.amount).toFixed(2)}</td>
                                    <td className="px-4 py-2 text-sm">${usdVal}</td>
                                    <td className="px-4 py-2 text-sm">
                                      <span className={positive ? "text-green-600" : "text-red-600"}>${profit}</span>
                                    </td>
                                    <td className="px-4 py-2 text-sm">
                                      <Button size="sm" variant="destructive" onClick={() => openModal(ln, c)}>
                                        Liquidate
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {liquidatable.map((ln: any) => (
              <div key={ln.id} className="border rounded-lg bg-white shadow-sm">
                <div 
                  className="p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => toggle(ln.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">{shorten(ln.user)}</span>
                      <CopyButton address={ln.user} />
                    </div>
                    <span className="text-sm">{expanded[ln.id] ? "▾" : "▸"}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Borrowed:</span>
                      <span>{weiToEther(ln.amount).toFixed(2)} {ln.assetSymbol}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Health Factor:</span>
                      <span className={`font-medium ${ln.healthFactor < 1 ? 'text-red-600':'text-yellow-600'}`}>
                        {(ln.healthFactor * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
                {expanded[ln.id] && (
                  <div className="border-t bg-gray-50 p-4">
                    <div className="space-y-3">
                      {ln.collaterals.map((c: any, idx: number) => {
                        const usdVal = weiToEther(c.usdValue).toFixed(2);
                        const profitNum = Number(BigInt(c.expectedProfit)) / 1e18;
                        const positive = profitNum > 0;
                        const profit = profitNum.toFixed(2);
                        return (
                          <div key={idx} className="bg-white p-3 rounded border">
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <div className="font-medium text-sm">{c.symbol || shorten(c.asset)}</div>
                                <div className="text-xs text-gray-500">
                                  Amount: {weiToEther(c.amount).toFixed(2)}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Value: ${usdVal}
                                </div>
                                <div className="text-xs">
                                  Profit: <span className={positive ? "text-green-600" : "text-red-600"}>${profit}</span>
                                </div>
                              </div>
                              <Button size="sm" variant="destructive" onClick={() => openModal(ln, c)}>
                                Liquidate
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {modalData && (
        <LiquidateModal
          key={`${modalData.loan.id}-${modalData.collateral.asset}`}
          open={!!modalData}
          onOpenChange={(open) => {
            if (!open) closeModal();
          }}
          loan={modalData.loan}
          collateral={modalData.collateral}
          onSuccess={async () => {
            await refreshData();
            closeModal();
          }}
        />
      )}
    </div>
  );
};

export default LiquidationsSection; 
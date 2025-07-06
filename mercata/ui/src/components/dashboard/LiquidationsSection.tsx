import React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import CopyButton from "../ui/copy";
import { useLiquidationContext } from "@/context/LiquidationContext";

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
  const { liquidatable, loading, error, executeLiquidation } = useLiquidationContext();
  const { toast } = useToast();

  const handleLiquidate = async (id: string) => {
    try {
      await executeLiquidation(id);
      toast({ title: "Liquidation submitted", variant: "success" });
    } catch (err: any) {
      toast({
        title: "Liquidation failed",
        description: err.message || "Error executing liquidation",
        variant: "destructive",
      });
    }
  };

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div>
      <h3 className="font-semibold mb-2">Liquidatable Positions</h3>
      {loading ? (
        <div>Loading...</div>
      ) : (
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
                                  <Button size="sm" variant="destructive" onClick={() => handleLiquidate(ln.id)}>
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
      )}
    </div>
  );
};

export default LiquidationsSection; 
import React, { useEffect, useState } from "react";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface LiquidationEntry {
  id: string;
  user: string;
  asset: string;
  assetSymbol?: string;
  amount: string;
  collateralAsset: string;
  collateralSymbol?: string;
  collateralAmount: string;
  healthFactor: number;
}

const shorten = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);
const weiToEther = (v: string) => {
  try {
    const bn = BigInt(v);
    return Number(bn) / 1e18;
  } catch {
    return 0;
  }
};

const LiquidationsSection: React.FC = () => {
  const [liquidatable, setLiquidatable] = useState<LiquidationEntry[]>([]);
  const [watchlist, setWatchlist] = useState<LiquidationEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [liqRes, watchRes] = await Promise.all([
        api.get<LiquidationEntry[]>("/lend/liquidate"),
        api.get<LiquidationEntry[]>("/lend/liquidate/near-unhealthy?margin=0.2"),
      ]);
      setLiquidatable(liqRes.data || []);
      setWatchlist(watchRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleLiquidate = async (id: string) => {
    try {
      await api.post(`/lend/liquidate/${id}`);
      toast({ title: "Liquidation submitted", variant: "success" });
      fetchData();
    } catch (err: any) {
      toast({
        title: "Liquidation failed",
        description: err.message || "Error executing liquidation",
        variant: "destructive",
      });
    }
  };

  const renderRow = (l: LiquidationEntry, showAction: boolean) => (
    <tr key={l.id} className="border-t">
      <td className="px-4 py-2 text-sm">{l.id}</td>
      <td className="px-4 py-2 text-sm">{shorten(l.user)}</td>
      <td className="px-4 py-2 text-sm">
        {weiToEther(l.collateralAmount).toFixed(2)} {l.collateralSymbol || shorten(l.collateralAsset)}
      </td>
      <td className="px-4 py-2 text-sm">
        {weiToEther(l.amount).toFixed(2)} {l.assetSymbol || shorten(l.asset)}
      </td>
      <td className="px-4 py-2 text-sm font-medium {l.healthFactor < 1 ? 'text-red-600' : 'text-yellow-600'}">
        {(l.healthFactor * 100).toFixed(2)}%
      </td>
      {showAction && <td className="px-4 py-2 text-sm">--</td>}
      {showAction && (
        <td className="px-4 py-2">
          <Button size="sm" variant="destructive" onClick={() => handleLiquidate(l.id)}>
            Liquidate
          </Button>
        </td>
      )}
    </tr>
  );

  return (
    <div>
      {/* Search bar removed for now */}

      {/* Liquidatable table */}
      <h3 className="font-semibold mb-2">Liquidatable Loans</h3>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="min-w-full text-left border">
          <thead className="bg-gray-100 text-xs uppercase">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Borrower</th>
              <th className="px-4 py-2">Collateral</th>
              <th className="px-4 py-2">Borrowed</th>
              <th className="px-4 py-2">Health Factor</th>
              <th className="px-4 py-2">Profit</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {liquidatable.map((l) => renderRow(l, true))}
          </tbody>
        </table>
      )}

      {/* Danger zone */}
      <h3 className="font-semibold mt-8 mb-2">Danger Zone (Almost Liquidatable)</h3>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="min-w-full text-left border">
          <thead className="bg-gray-100 text-xs uppercase">
            <tr>
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Borrower</th>
              <th className="px-4 py-2">Collateral</th>
              <th className="px-4 py-2">Borrowed</th>
              <th className="px-4 py-2">Health Factor</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map((l) => renderRow(l, false))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default LiquidationsSection; 
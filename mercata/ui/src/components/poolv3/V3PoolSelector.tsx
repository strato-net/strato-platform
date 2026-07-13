import { useMemo, useState } from "react";
import { PoolV3 } from "@/interface";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { formatPriceWad } from "./poolV3Utils";

interface V3PoolSelectorProps {
  pools: PoolV3[];
  selected: PoolV3 | null;
  onSelect: (pool: PoolV3) => void;
  loading: boolean;
}

const TokenPairIcons = ({ pool }: { pool: PoolV3 }) => (
  <div className="flex -space-x-1.5">
    {[pool.token0, pool.token1].map((token) =>
      token.image ? (
        <img
          key={token.address}
          src={token.image}
          alt={token.symbol}
          className="w-6 h-6 rounded-full object-cover border border-border bg-card"
        />
      ) : (
        <div
          key={token.address}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-medium bg-strato-blue border border-border"
        >
          {token.symbol?.slice(0, 1)}
        </div>
      )
    )}
  </div>
);

const V3PoolSelector = ({ pools, selected, onSelect, loading }: V3PoolSelectorProps) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pools;
    return pools.filter((p) => p.poolName.toLowerCase().includes(q));
  }, [pools, search]);

  return (
    <div className="bg-card shadow-sm rounded-xl p-4 border border-border">
      <h3 className="text-sm font-semibold mb-3">Select a pool</h3>
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search pools"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>
      <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
        {loading && pools.length === 0 && (
          <span className="text-sm text-muted-foreground p-2">Loading pools…</span>
        )}
        {!loading && filtered.length === 0 && (
          <span className="text-sm text-muted-foreground p-2">No V3 pools found</span>
        )}
        {filtered.map((pool) => (
          <button
            key={pool.address}
            onClick={() => onSelect(pool)}
            className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
              selected?.address === pool.address
                ? "border-strato-blue bg-muted"
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <TokenPairIcons pool={pool} />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {pool.token0.symbol}/{pool.token1.symbol}
                </span>
                <span className="text-xs text-muted-foreground">
                  1 {pool.token0.symbol} ≈ {formatPriceWad(pool.priceWad)} {pool.token1.symbol}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {pool.fee / 10000}%
              </Badge>
              <span className="text-xs text-muted-foreground">
                ${pool.totalLiquidityUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default V3PoolSelector;

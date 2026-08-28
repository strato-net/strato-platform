import { useEffect, useMemo, useState } from "react";
import { PoolV3 } from "@/interface";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { formatPriceWad, priceDomainEdge } from "./poolV3Utils";
import V3NewPositionCard from "./V3NewPositionCard";
import V3PoolStatusBanner from "./V3PoolStatusBanner";

interface V3PoolsTabProps {
  pools: PoolV3[];
  loading: boolean;
  onMinted: () => void;
}

/** A token pair with all of its fee-tier pools. */
interface PairGroup {
  key: string;
  token0: PoolV3["token0"];
  token1: PoolV3["token1"];
  pools: PoolV3[]; // fee tiers, deepest liquidity first
  tvl: number;
  volume24h: number;
  bestApy: number;
}

const formatUsd = (value: number): string =>
  `$${(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const TokenPairIcons = ({ token0, token1 }: { token0: PoolV3["token0"]; token1: PoolV3["token1"] }) => (
  <div className="flex -space-x-1.5">
    {[token0, token1].map((token) =>
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
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-primary-foreground font-medium bg-primary border border-border"
        >
          {token.symbol?.slice(0, 1)}
        </div>
      )
    )}
  </div>
);

/** Group pools by unordered token pair, so all fee tiers of a pair sit together. */
const groupByPair = (pools: PoolV3[]): PairGroup[] => {
  const groups = new Map<string, PairGroup>();
  for (const pool of pools) {
    const key = [pool.token0.address, pool.token1.address].sort().join("-");
    const existing = groups.get(key);
    if (existing) {
      existing.pools.push(pool);
      existing.tvl += pool.totalLiquidityUSD;
      existing.volume24h += pool.volume24hUSD || 0;
      existing.bestApy = Math.max(existing.bestApy, pool.apy || 0);
    } else {
      groups.set(key, {
        key,
        token0: pool.token0,
        token1: pool.token1,
        pools: [pool],
        tvl: pool.totalLiquidityUSD,
        volume24h: pool.volume24hUSD || 0,
        bestApy: pool.apy || 0,
      });
    }
  }
  const list = [...groups.values()];
  list.forEach((g) => g.pools.sort((a, b) => b.totalLiquidityUSD - a.totalLiquidityUSD));
  return list.sort((a, b) => b.tvl - a.tvl);
};

const V3PoolsTab = ({ pools, loading, onMinted }: V3PoolsTabProps) => {
  const [search, setSearch] = useState("");
  const [pairKey, setPairKey] = useState<string | null>(null);
  const [poolAddress, setPoolAddress] = useState<string | null>(null);

  // Disabled pools are hidden from the browser entirely — you can't add liquidity
  // to them, so they shouldn't appear as pairs or fee tiers at all.
  const groups = useMemo(() => groupByPair(pools.filter((p) => !p.isDisabled)), [pools]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.token0.symbol}/${g.token1.symbol}`.toLowerCase().includes(q));
  }, [groups, search]);

  // Default selection: first pair, its deepest-liquidity tier.
  useEffect(() => {
    if (!groups.length) {
      setPairKey(null);
      setPoolAddress(null);
      return;
    }
    if (!pairKey || !groups.find((g) => g.key === pairKey)) {
      setPairKey(groups[0].key);
      setPoolAddress(groups[0].pools[0].address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const selectedGroup = groups.find((g) => g.key === pairKey) ?? null;
  const selectedPool = selectedGroup?.pools.find((p) => p.address === poolAddress) ?? selectedGroup?.pools[0] ?? null;

  const selectPair = (group: PairGroup) => {
    setPairKey(group.key);
    setPoolAddress(group.pools[0].address); // default to deepest tier
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6 items-start">
      {/* Left: pair browser */}
      <div className="lg:col-span-2 bg-card shadow-sm rounded-xl p-4 border border-border">
        <h3 className="text-sm font-semibold mb-3">Pools</h3>
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search pairs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto">
          {loading && pools.length === 0 && (
            <span className="text-sm text-muted-foreground p-2">Loading pools…</span>
          )}
          {!loading && filtered.length === 0 && (
            <span className="text-sm text-muted-foreground p-2">No pools found</span>
          )}
          {filtered.map((group) => (
            <button
              key={group.key}
              onClick={() => selectPair(group)}
              className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
                pairKey === group.key ? "border-primary bg-muted" : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <TokenPairIcons token0={group.token0} token1={group.token1} />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">
                    {group.token0.symbol}/{group.token1.symbol}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.pools.length} fee {group.pools.length === 1 ? "tier" : "tiers"}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end flex-shrink-0 text-xs">
                <span className="text-muted-foreground tabular-nums">{formatUsd(group.tvl)} TVL</span>
                <span className="text-muted-foreground tabular-nums">{formatUsd(group.volume24h)} 24h vol</span>
                {group.bestApy > 0 && (
                  <span className="text-success font-medium tabular-nums">up to {group.bestApy.toFixed(2)}% APY</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: fee-tier picker + new position */}
      <div className="lg:col-span-3 space-y-4">
        {selectedGroup && selectedPool ? (
          <>
            <div className="bg-card shadow-sm rounded-xl p-4 border border-border">
              <div className="flex items-center gap-2 mb-3">
                <TokenPairIcons token0={selectedGroup.token0} token1={selectedGroup.token1} />
                <span className="text-sm font-semibold">
                  {selectedGroup.token0.symbol}/{selectedGroup.token1.symbol}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">Fee tier</span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {selectedGroup.pools.map((pool) => (
                  <button
                    key={pool.address}
                    onClick={() => setPoolAddress(pool.address)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      selectedPool.address === pool.address
                        ? "border-primary bg-muted"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-medium tabular-nums">{pool.fee / 10000}%</span>
                      {pool.isPaused ? (
                        <span className="text-[11px] text-warning font-medium whitespace-nowrap">Paused</span>
                      ) : (pool.apy || 0) > 0 ? (
                        <span className="text-[11px] text-success font-medium whitespace-nowrap tabular-nums">
                          {pool.apy.toFixed(2)}% APY
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatUsd(pool.totalLiquidityUSD)} TVL
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {formatUsd(pool.volume24hUSD)} 24h vol
                    </div>
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                {priceDomainEdge(selectedPool) ? (
                  <span className="text-warning">
                    Price unavailable — one-sided liquidity (the pool has no{" "}
                    {priceDomainEdge(selectedPool) === "max"
                      ? selectedPool.token0.symbol
                      : selectedPool.token1.symbol}{" "}
                    left)
                  </span>
                ) : (
                  <>
                    Current price: 1 {selectedPool.token0.symbol} ≈ {formatPriceWad(selectedPool.priceWad)}{" "}
                    {selectedPool.token1.symbol}
                  </>
                )}
              </div>
            </div>

            {/* Paused pools stay browsable but can't take new liquidity — say so up front. */}
            <V3PoolStatusBanner pool={selectedPool} />

            {/* keyed by pool so the form fully resets when the tier changes */}
            <V3NewPositionCard key={selectedPool.address} pool={selectedPool} onMinted={onMinted} />
          </>
        ) : (
          <div className="bg-card shadow-sm rounded-xl p-6 border border-border text-sm text-muted-foreground">
            {loading ? "Loading pools…" : "Select a pair to add liquidity."}
          </div>
        )}
      </div>
    </div>
  );
};

export default V3PoolsTab;

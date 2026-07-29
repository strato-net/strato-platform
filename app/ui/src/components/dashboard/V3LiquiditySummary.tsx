import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PoolV3 } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useUser } from "@/context/UserContext";
import { formatTokenAmount } from "@/components/poolv3/poolV3Utils";

/**
 * Compact dashboard section for V3 liquidity, mirroring how V2 LP tokens surface in
 * the assets list. One row per token pair, aggregated across fee tiers and positions
 * (principal at spot + uncollected). Renders nothing when the user has no V3 liquidity.
 */
interface PairSummary {
  key: string;
  token0: PoolV3["token0"];
  token1: PoolV3["token1"];
  positionCount: number;
  inRangeCount: number;
  amount0: bigint;
  amount1: bigint;
}

const PairIcons = ({ token0, token1 }: { token0: PoolV3["token0"]; token1: PoolV3["token1"] }) => (
  <div className="flex -space-x-1.5 flex-shrink-0">
    {[token0, token1].map((token) =>
      token.image ? (
        <img
          key={token.address}
          src={token.image}
          alt={token.symbol}
          className="w-7 h-7 rounded-full object-cover border border-border bg-card"
        />
      ) : (
        <div
          key={token.address}
          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] text-white font-medium bg-strato-blue border border-border"
        >
          {token.symbol?.slice(0, 1)}
        </div>
      )
    )}
  </div>
);

const V3LiquiditySummary = () => {
  const { isLoggedIn } = useUser();
  const { fetchV3Positions, fetchV3Pools } = useSwapContext();
  const navigate = useNavigate();
  const [pairs, setPairs] = useState<PairSummary[] | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setPairs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [positions, pools] = await Promise.all([fetchV3Positions(), fetchV3Pools()]);
        if (cancelled) return;
        const poolsByAddress = new Map(pools.map((p) => [p.address, p]));
        const byPair = new Map<string, PairSummary>();
        for (const pos of positions) {
          const pool = poolsByAddress.get(pos.poolAddress);
          if (!pool) continue;
          let amount0 = 0n;
          let amount1 = 0n;
          try {
            // the user's full claim on the pool: principal at spot + uncollected
            amount0 = BigInt(pos.amount0) + BigInt(pos.tokensOwed0) + BigInt(pos.pendingFees0 || "0");
            amount1 = BigInt(pos.amount1) + BigInt(pos.tokensOwed1) + BigInt(pos.pendingFees1 || "0");
          } catch {
            continue;
          }
          const key = [pool.token0.address, pool.token1.address].sort().join("-");
          const existing = byPair.get(key);
          if (existing) {
            existing.positionCount += 1;
            existing.inRangeCount += pos.inRange ? 1 : 0;
            existing.amount0 += amount0;
            existing.amount1 += amount1;
          } else {
            byPair.set(key, {
              key,
              token0: pool.token0,
              token1: pool.token1,
              positionCount: 1,
              inRangeCount: pos.inRange ? 1 : 0,
              amount0,
              amount1,
            });
          }
        }
        setPairs([...byPair.values()]);
      } catch {
        if (!cancelled) setPairs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, fetchV3Positions, fetchV3Pools]);

  // only shown when the user actually has V3 liquidity
  if (!pairs || pairs.length === 0) return null;

  const goToPositions = () => navigate("/dashboard/v3-liquidity?tab=positions");

  return (
    <div className="mb-8 bg-card shadow-sm rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 md:px-6 pt-4 md:pt-5 pb-3">
        <h3 className="text-base md:text-lg font-semibold">V3 Pool Liquidity</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={goToPositions}
          className="h-7 px-2.5 text-xs"
        >
          Manage
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {pairs.map((pair) => (
          <button
            key={pair.key}
            type="button"
            onClick={goToPositions}
            className="w-full flex items-center justify-between gap-3 px-4 md:px-6 py-3 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <PairIcons token0={pair.token0} token1={pair.token1} />
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {pair.token0.symbol}/{pair.token1.symbol}
                </span>
                <span className="text-xs text-muted-foreground">
                  {pair.positionCount} {pair.positionCount === 1 ? "position" : "positions"}
                  {" · "}
                  {pair.inRangeCount > 0 ? `${pair.inRangeCount} in range` : "out of range"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex flex-col items-end text-xs">
                {pair.amount0 > 0n && (
                  <span className="font-medium">
                    {formatTokenAmount(pair.amount0, pair.token0.decimals)} {pair.token0.symbol}
                  </span>
                )}
                {pair.amount1 > 0n && (
                  <span className="font-medium">
                    {formatTokenAmount(pair.amount1, pair.token1.decimals)} {pair.token1.symbol}
                  </span>
                )}
                {pair.amount0 === 0n && pair.amount1 === 0n && (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default V3LiquiditySummary;

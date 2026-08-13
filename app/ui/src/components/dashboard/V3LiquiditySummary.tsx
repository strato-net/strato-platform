import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PoolV3, PoolV3Position } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useUser } from "@/context/UserContext";
import { formatTokenAmount } from "@/components/poolv3/poolV3Utils";
import TokenPairIcons from "@/components/poolv3/TokenPairIcons";

/**
 * Compact dashboard section for V3 liquidity: one row per position — NFT and legacy
 * positions together, marked by kind. NFT rows open the position NFT's detail page;
 * legacy rows open the position on the V3 Liquidity page (focused via the `position`
 * query param). Renders nothing when the user has no V3 liquidity.
 */
interface PositionRow {
  key: string;
  position: PoolV3Position;
  pool: PoolV3;
  /** the user's full claim on the pool: principal at spot + uncollected, per token */
  amount0: bigint;
  amount1: bigint;
}

const V3LiquiditySummary = () => {
  const { isLoggedIn } = useUser();
  const { fetchV3Positions, fetchV3Pools } = useSwapContext();
  const navigate = useNavigate();
  const [rows, setRows] = useState<PositionRow[] | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setRows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [positions, pools] = await Promise.all([fetchV3Positions(), fetchV3Pools()]);
        if (cancelled) return;
        const poolsByAddress = new Map(pools.map((p) => [p.address, p]));
        const built: PositionRow[] = [];
        for (const pos of positions) {
          const pool = poolsByAddress.get(pos.poolAddress);
          if (!pool) continue;
          let amount0 = 0n;
          let amount1 = 0n;
          try {
            amount0 = BigInt(pos.amount0) + BigInt(pos.tokensOwed0) + BigInt(pos.pendingFees0 || "0");
            amount1 = BigInt(pos.amount1) + BigInt(pos.tokensOwed1) + BigInt(pos.pendingFees1 || "0");
          } catch {
            continue;
          }
          const key =
            pos.kind === "nft" && pos.tokenId !== undefined
              ? `nft:${pos.tokenId}`
              : `${pos.poolAddress}:${pos.tickLower}:${pos.tickUpper}`;
          built.push({ key, position: pos, pool, amount0, amount1 });
        }
        setRows(built);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, fetchV3Positions, fetchV3Pools]);

  // only shown when the user actually has V3 liquidity
  if (!rows || rows.length === 0) return null;

  const openRow = ({ position, key }: PositionRow) => {
    if (position.kind === "nft" && position.tokenId !== undefined) {
      navigate(`/dashboard/v3-liquidity/${position.tokenId}`);
    } else {
      navigate(`/dashboard/v3-liquidity?tab=positions&position=${encodeURIComponent(key)}`);
    }
  };

  return (
    <div className="mb-8 bg-card shadow-sm rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 md:px-6 pt-4 md:pt-5 pb-3">
        <h3 className="text-base md:text-lg font-semibold">V3 Pool Liquidity</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate("/dashboard/v3-liquidity?tab=positions")}
          className="h-7 px-2.5 text-xs"
        >
          Manage
          <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {rows.map((row) => {
          const { position, pool } = row;
          const isNft = position.kind === "nft" && position.tokenId !== undefined;
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => openRow(row)}
              className="w-full flex items-center justify-between gap-3 px-4 md:px-6 py-3 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <TokenPairIcons token0={pool.token0} token1={pool.token1} size="md" />
                <div className="flex flex-col min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium min-w-0">
                    <span className="truncate">
                      {pool.token0.symbol}/{pool.token1.symbol}
                    </span>
                    {isNft ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                        NFT
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 flex-shrink-0 text-muted-foreground"
                        title="Created before position NFTs; still fully manageable"
                      >
                        Legacy
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {pool.fee / 10000}%{" · "}
                    {position.inRange ? "in range" : "out of range"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex flex-col items-end text-xs">
                  {row.amount0 > 0n && (
                    <span className="font-medium">
                      {formatTokenAmount(row.amount0, pool.token0.decimals)} {pool.token0.symbol}
                    </span>
                  )}
                  {row.amount1 > 0n && (
                    <span className="font-medium">
                      {formatTokenAmount(row.amount1, pool.token1.decimals)} {pool.token1.symbol}
                    </span>
                  )}
                  {row.amount0 === 0n && row.amount1 === 0n && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default V3LiquiditySummary;

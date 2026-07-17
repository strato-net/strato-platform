import { useState } from "react";
import { PoolV3, PoolV3Position } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { formatTokenAmount } from "./poolV3Utils";
import { formatTickAsPrice } from "./poolV3Utils";

interface V3PositionsListProps {
  pool: PoolV3;
  positions: PoolV3Position[];
  loading: boolean;
  onChanged: () => void;
}

const V3PositionsList = ({ pool, positions, loading, onChanged }: V3PositionsListProps) => {
  const { burnV3, collectV3, loading: txLoading } = useSwapContext();
  const { toast } = useToast();
  const [removePercents, setRemovePercents] = useState<Record<string, number>>({});

  const positionKey = (p: PoolV3Position) => `${p.tickLower}:${p.tickUpper}`;

  const handleBurn = async (position: PoolV3Position) => {
    const percent = removePercents[positionKey(position)] ?? 100;
    const liquidity = (BigInt(position.liquidity) * BigInt(Math.round(percent * 100))) / 10000n;
    if (liquidity === 0n) return;
    try {
      await burnV3({
        poolAddress: pool.address,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: liquidity.toString(),
        collect: true,
      });
      toast({ title: "Liquidity removed", description: `Removed ${percent}% and collected owed tokens`, variant: "success" });
      onChanged();
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const handleCollect = async (position: PoolV3Position) => {
    try {
      await collectV3({
        poolAddress: pool.address,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      });
      toast({ title: "Collected", description: "Owed tokens sent to your wallet", variant: "success" });
      onChanged();
    } catch (err) {
      toast({
        title: "Collect failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card shadow-sm rounded-xl p-4 border border-border space-y-3">
      <h3 className="text-sm font-semibold">My positions</h3>
      {loading && positions.length === 0 && (
        <span className="text-sm text-muted-foreground">Loading positions…</span>
      )}
      {!loading && positions.length === 0 && (
        <span className="text-sm text-muted-foreground">No positions in this pool yet</span>
      )}
      {positions.map((position) => {
        const key = positionKey(position);
        const percent = removePercents[key] ?? 100;
        const hasLiquidity = BigInt(position.liquidity) > 0n;
        const hasOwed = BigInt(position.tokensOwed0) > 0n || BigInt(position.tokensOwed1) > 0n;
        return (
          <div key={key} className="rounded-lg border border-border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {formatTickAsPrice(position.tickLower)} – {formatTickAsPrice(position.tickUpper)}{" "}
                <span className="text-xs text-muted-foreground">
                  {pool.token1.symbol}/{pool.token0.symbol}
                </span>
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${
                  position.inRange ? "text-green-600 border-green-600/40" : "text-yellow-600 border-yellow-600/40"
                }`}
              >
                {position.inRange ? "In range" : "Out of range"}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col">
                <span className="text-muted-foreground">Position value</span>
                <span className="font-medium">
                  {formatTokenAmount(position.amount0, pool.token0.decimals)} {pool.token0.symbol}
                </span>
                <span className="font-medium">
                  {formatTokenAmount(position.amount1, pool.token1.decimals)} {pool.token1.symbol}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Uncollected (principal + fees)</span>
                <span className="font-medium">
                  {formatTokenAmount(position.tokensOwed0, pool.token0.decimals)} {pool.token0.symbol}
                </span>
                <span className="font-medium">
                  {formatTokenAmount(position.tokensOwed1, pool.token1.decimals)} {pool.token1.symbol}
                </span>
              </div>
            </div>

            {hasLiquidity && (
              <div className="flex items-center gap-3">
                <Slider
                  value={[percent]}
                  min={1}
                  max={100}
                  step={1}
                  onValueChange={(value) => setRemovePercents((prev) => ({ ...prev, [key]: value[0] }))}
                  className="flex-1"
                />
                <span className="text-xs font-semibold w-10 text-right">{percent}%</span>
              </div>
            )}

            <div className="flex gap-2">
              {hasLiquidity && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={txLoading || pool.isDisabled}
                  onClick={() => handleBurn(position)}
                >
                  Remove {percent}%
                </Button>
              )}
              {hasOwed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={txLoading || pool.isDisabled}
                  onClick={() => handleCollect(position)}
                >
                  Collect
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default V3PositionsList;

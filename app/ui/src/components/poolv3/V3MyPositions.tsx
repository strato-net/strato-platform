import { useEffect, useMemo, useState } from "react";
import { PoolV3, PoolV3Position } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { formatTokenAmount, formatTickAsPrice, formatPriceWad, poolV3TxAmounts, describePoolAmounts, priceDomainEdge } from "./poolV3Utils";
import V3ConfirmDialog, { ConfirmRow } from "./V3ConfirmDialog";

type ConfirmableAction = "remove" | "fees" | "collect";

interface V3MyPositionsProps {
  positions: PoolV3Position[];
  poolsByAddress: Map<string, PoolV3>;
  loading: boolean;
  isLoggedIn: boolean;
  onChanged: () => void;
  onBrowsePools: () => void;
}

/** Positions for one pool (pair + fee tier). */
interface PoolGroup {
  pool: PoolV3;
  positions: PoolV3Position[];
}

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
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-medium bg-strato-blue border border-border"
        >
          {token.symbol?.slice(0, 1)}
        </div>
      )
    )}
  </div>
);

const V3MyPositions = ({
  positions,
  poolsByAddress,
  loading,
  isLoggedIn,
  onChanged,
  onBrowsePools,
}: V3MyPositionsProps) => {
  const { burnV3, collectV3, loading: txLoading } = useSwapContext();
  const { fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { toast } = useToast();

  // Withdrawn/collected tokens land in the wallet, and every tx pays its gas fee in
  // USDST/voucher — so alongside the pool/position reload, refresh the wallet token
  // balances and the USDST balance box. Nothing else on this page depends on tx results.
  const refreshAfterTx = () => {
    fetchUsdstBalance();
    fetchTokens();
    onChanged();
  };
  const [removePercents, setRemovePercents] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [selectedPoolAddress, setSelectedPoolAddress] = useState<string | null>(null);
  // Action awaiting user confirmation — every fund-moving button goes through the dialog
  const [confirm, setConfirm] = useState<{ action: ConfirmableAction; position: PoolV3Position } | null>(null);

  const positionKey = (p: PoolV3Position) => `${p.poolAddress}:${p.tickLower}:${p.tickUpper}`;

  // Group positions by pool, deepest-liquidity pool first.
  const groups = useMemo<PoolGroup[]>(() => {
    const byPool = new Map<string, PoolGroup>();
    for (const pos of positions) {
      const pool = poolsByAddress.get(pos.poolAddress);
      if (!pool) continue;
      const existing = byPool.get(pos.poolAddress);
      if (existing) existing.positions.push(pos);
      else byPool.set(pos.poolAddress, { pool, positions: [pos] });
    }
    return [...byPool.values()].sort((a, b) => b.pool.totalLiquidityUSD - a.pool.totalLiquidityUSD);
  }, [positions, poolsByAddress]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => `${g.pool.token0.symbol}/${g.pool.token1.symbol}`.toLowerCase().includes(q));
  }, [groups, search]);

  // Default selection: first pool that has positions.
  useEffect(() => {
    if (!groups.length) {
      setSelectedPoolAddress(null);
      return;
    }
    if (!selectedPoolAddress || !groups.find((g) => g.pool.address === selectedPoolAddress)) {
      setSelectedPoolAddress(groups[0].pool.address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const selectedGroup = groups.find((g) => g.pool.address === selectedPoolAddress) ?? null;

  const handleBurn = async (position: PoolV3Position) => {
    const key = positionKey(position);
    const percent = removePercents[key] ?? 100;
    const liquidity = (BigInt(position.liquidity) * BigInt(Math.round(percent * 100))) / 10000n;
    if (liquidity === 0n) return;
    try {
      const res = await burnV3({
        poolAddress: position.poolAddress,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: liquidity.toString(),
        collect: true,
      });
      // the batch's final collect() returns the total sent to the wallet (principal + fees)
      const pool = poolsByAddress.get(position.poolAddress);
      const amounts = poolV3TxAmounts(res);
      const received = pool && amounts ? describePoolAmounts(pool, amounts) : null;
      toast({
        title: "Liquidity removed",
        description: received
          ? `Removed ${percent}% — received ${received} (incl. fees)`
          : `Removed ${percent}% and collected owed tokens`,
        variant: "success",
      });
      refreshAfterTx();
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
      const res = await collectV3({
        poolAddress: position.poolAddress,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      });
      const pool = poolsByAddress.get(position.poolAddress);
      const amounts = poolV3TxAmounts(res);
      const received = pool && amounts ? describePoolAmounts(pool, amounts) : null;
      toast({
        title: "Collected",
        description: received
          ? `Collected ${received}`
          : amounts
            ? "Nothing was owed to collect"
            : "Owed tokens sent to your wallet",
        variant: "success",
      });
      refreshAfterTx();
    } catch (err) {
      toast({
        title: "Collect failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  // Realize + claim accrued fees without removing liquidity: burn(0) pokes the position so
  // fees land in the (Cirrus-readable) tokensOwed, and collect:true pays them — one atomic tx.
  // This is how fees are surfaced given the indexer can't expose live fee growth.
  const handleCollectFees = async (position: PoolV3Position) => {
    try {
      const res = await burnV3({
        poolAddress: position.poolAddress,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        liquidity: "0",
        collect: true,
      });
      const pool = poolsByAddress.get(position.poolAddress);
      const amounts = poolV3TxAmounts(res);
      const received = pool && amounts ? describePoolAmounts(pool, amounts) : null;
      toast({
        title: "Fees collected",
        description: received
          ? `Collected ${received} in fees`
          : amounts
            ? "No fees had accrued yet"
            : "Accrued fees sent to your wallet",
        variant: "success",
      });
      refreshAfterTx();
    } catch (err) {
      toast({
        title: "Collect failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const confirmedRun = async () => {
    if (!confirm) return;
    try {
      if (confirm.action === "remove") await handleBurn(confirm.position);
      else if (confirm.action === "fees") await handleCollectFees(confirm.position);
      else await handleCollect(confirm.position);
    } finally {
      setConfirm(null);
    }
  };

  // Dialog copy for the pending action (plain derivation — only meaningful while open)
  const confirmContent = (() => {
    if (!confirm) return null;
    const { action, position } = confirm;
    const pool = poolsByAddress.get(position.poolAddress);
    if (!pool) return null;
    const pairLabel = `${pool.token0.symbol}/${pool.token1.symbol} · ${pool.fee / 10000}%`;
    const rangeLabel = `${formatTickAsPrice(position.tickLower)} – ${formatTickAsPrice(position.tickUpper)} ${pool.token1.symbol}/${pool.token0.symbol}`;
    const uncollected = describePoolAmounts(pool, {
      amount0: BigInt(position.tokensOwed0) + BigInt(position.pendingFees0 ?? "0"),
      amount1: BigInt(position.tokensOwed1) + BigInt(position.pendingFees1 ?? "0"),
    });
    if (action === "remove") {
      const percent = removePercents[positionKey(position)] ?? 100;
      const receive = describePoolAmounts(pool, {
        amount0: (BigInt(position.amount0) * BigInt(percent)) / 100n,
        amount1: (BigInt(position.amount1) * BigInt(percent)) / 100n,
      });
      const rows: ConfirmRow[] = [
        { label: "Position", value: pairLabel },
        { label: "Range", value: rangeLabel },
        { label: "Removing", value: `${percent}% of your liquidity` },
        ...(receive ? [{ label: "Est. receive", value: receive }] : []),
        ...(uncollected ? [{ label: "Plus uncollected fees", value: uncollected }] : []),
      ];
      return {
        title: "Remove liquidity",
        description: "The withdrawn tokens and any uncollected fees are sent to your wallet.",
        rows,
        warning: percent === 100 ? "This removes your entire position." : undefined,
        confirmLabel: `Remove ${percent}%`,
        destructive: true,
      };
    }
    if (action === "fees") {
      return {
        title: "Collect fees",
        description:
          "Realizes the fees this position has earned and sends them to your wallet. Your liquidity stays in place.",
        rows: [
          { label: "Position", value: pairLabel },
          { label: "Range", value: rangeLabel },
          { label: "Est. fees (incl. pending)", value: uncollected ?? "0" },
        ] as ConfirmRow[],
        warning: undefined,
        confirmLabel: "Collect fees",
        destructive: false,
      };
    }
    return {
      title: "Collect owed tokens",
      description: "Sends this position's collectable balance to your wallet.",
      rows: [
        { label: "Position", value: pairLabel },
        { label: "Owed", value: uncollected ?? "0" },
      ] as ConfirmRow[],
      warning: undefined,
      confirmLabel: "Collect",
      destructive: false,
    };
  })();

  if (!isLoggedIn) {
    return (
      <div className="bg-card shadow-sm rounded-xl p-6 border border-border text-sm text-muted-foreground">
        Sign in to view your positions.
      </div>
    );
  }

  if (loading && positions.length === 0) {
    return (
      <div className="bg-card shadow-sm rounded-xl p-6 border border-border text-sm text-muted-foreground">
        Loading positions…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="bg-card shadow-sm rounded-xl p-8 border border-border text-center">
        <p className="text-sm text-muted-foreground mb-3">You don't have any liquidity positions yet.</p>
        <Button className="bg-strato-blue hover:bg-strato-blue/90" onClick={onBrowsePools}>
          Add liquidity
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6 items-start">
      {/* Left: pools the user has positions in */}
      <div className="lg:col-span-2 bg-card shadow-sm rounded-xl p-4 border border-border">
        <h3 className="text-sm font-semibold mb-3">Your pools</h3>
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
          {filtered.length === 0 && <span className="text-sm text-muted-foreground p-2">No pools found</span>}
          {filtered.map(({ pool, positions: poolPositions }) => (
            <button
              key={pool.address}
              onClick={() => setSelectedPoolAddress(pool.address)}
              className={`flex items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors ${
                selectedPoolAddress === pool.address ? "border-strato-blue bg-muted" : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <TokenPairIcons token0={pool.token0} token1={pool.token1} />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">
                    {pool.token0.symbol}/{pool.token1.symbol}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {poolPositions.length} {poolPositions.length === 1 ? "position" : "positions"}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                {pool.fee / 10000}%
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Right: positions for the selected pool */}
      <div className="lg:col-span-3 space-y-4">
        {selectedGroup ? (
          <>
            <div className="bg-card shadow-sm rounded-xl p-4 border border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <TokenPairIcons token0={selectedGroup.pool.token0} token1={selectedGroup.pool.token1} />
                <span className="text-sm font-semibold truncate">
                  {selectedGroup.pool.token0.symbol}/{selectedGroup.pool.token1.symbol}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {selectedGroup.pool.fee / 10000}%
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground text-right flex-shrink-0">
                {priceDomainEdge(selectedGroup.pool) ? (
                  <span className="text-yellow-600">
                    Price unavailable — no{" "}
                    {priceDomainEdge(selectedGroup.pool) === "max"
                      ? selectedGroup.pool.token0.symbol
                      : selectedGroup.pool.token1.symbol}{" "}
                    left in the pool
                  </span>
                ) : (
                  <>
                    1 {selectedGroup.pool.token0.symbol} ≈ {formatPriceWad(selectedGroup.pool.priceWad)}{" "}
                    {selectedGroup.pool.token1.symbol}
                  </>
                )}
              </span>
            </div>

            {selectedGroup.positions.map((position) => {
              const key = positionKey(position);
              const percent = removePercents[key] ?? 100;
              const hasLiquidity = BigInt(position.liquidity) > 0n;
              // uncollected = realized on-chain owed + fees earned since the last touch
              // (the backend pokes before collect, so both are collectable together)
              const uncollected0 = BigInt(position.tokensOwed0) + BigInt(position.pendingFees0 ?? "0");
              const uncollected1 = BigInt(position.tokensOwed1) + BigInt(position.pendingFees1 ?? "0");
              const hasOwed = uncollected0 > 0n || uncollected1 > 0n;
              const pool = selectedGroup.pool;

              return (
                <div key={key} className="bg-card shadow-sm rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Range: {formatTickAsPrice(position.tickLower)} – {formatTickAsPrice(position.tickUpper)}{" "}
                      {pool.token1.symbol}/{pool.token0.symbol}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {(position.apy || 0) > 0 && (
                        <span className="text-[11px] text-green-600 font-medium whitespace-nowrap">
                          {position.apy.toFixed(2)}% APY
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${
                          position.inRange
                            ? "text-green-600 border-green-600/40"
                            : "text-yellow-600 border-yellow-600/40"
                        }`}
                      >
                        {position.inRange ? "In range" : "Out of range"}
                      </Badge>
                    </div>
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
                      <span className="text-muted-foreground">Uncollected (incl. pending fees)</span>
                      <span className="font-medium">
                        {formatTokenAmount(uncollected0.toString(), pool.token0.decimals)} {pool.token0.symbol}
                      </span>
                      <span className="font-medium">
                        {formatTokenAmount(uncollected1.toString(), pool.token1.decimals)} {pool.token1.symbol}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-muted-foreground">
                    Accrued fees are paid out when you Collect fees (or remove liquidity).
                  </p>

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
                        onClick={() => setConfirm({ action: "remove", position })}
                      >
                        Remove {percent}%
                      </Button>
                    )}
                    {hasLiquidity && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={txLoading || pool.isDisabled}
                        onClick={() => setConfirm({ action: "fees", position })}
                      >
                        Collect fees
                      </Button>
                    )}
                    {!hasLiquidity && hasOwed && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={txLoading || pool.isDisabled}
                        onClick={() => setConfirm({ action: "collect", position })}
                      >
                        Collect
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="bg-card shadow-sm rounded-xl p-6 border border-border text-sm text-muted-foreground">
            Select a pool to see your positions.
          </div>
        )}
      </div>

      <V3ConfirmDialog
        open={!!confirmContent}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirmContent?.title ?? ""}
        description={confirmContent?.description}
        rows={confirmContent?.rows ?? []}
        warning={confirmContent?.warning}
        confirmLabel={confirmContent?.confirmLabel ?? "Confirm"}
        destructive={confirmContent?.destructive}
        onConfirm={confirmedRun}
        loading={txLoading}
      />
    </div>
  );
};

export default V3MyPositions;

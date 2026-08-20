import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PoolV3, PoolV3AmountsPreview, PoolV3LiquidityDistribution } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import {
  priceToTick,
  snapTick,
  tickToPriceInput,
  formatTokenAmount,
  formatTickAsPrice,
  poolV3TxAmounts,
  describePoolAmounts,
  priceDomainEdge,
} from "./poolV3Utils";
import V3ConfirmDialog, { ConfirmRow } from "./V3ConfirmDialog";
import V3LiquidityChart from "./V3LiquidityChart";

const MINT_SLIPPAGE_BPS = 100n; // 1% downward tolerance on the amount minimums

// One-click range strategies, as percentage bounds relative to the current price.
// A 0 bound anchors that side of the range at the current tick (one-sided strategies).
const RANGE_PRESETS = [
  { label: "Stable", hint: "±0.1%", lowerPct: -0.001, upperPct: 0.001 },
  { label: "Tight", hint: "±5%", lowerPct: -0.05, upperPct: 0.05 },
  { label: "Wide", hint: "−50% / +100%", lowerPct: -0.5, upperPct: 1 },
  { label: "One-sided lower", hint: "−50%", lowerPct: -0.5, upperPct: 0 },
  { label: "One-sided upper", hint: "+100%", lowerPct: 0, upperPct: 1 },
];

interface V3NewPositionCardProps {
  pool: PoolV3;
  onMinted: () => void;
}

const V3NewPositionCard = ({ pool, onMinted }: V3NewPositionCardProps) => {
  const { getV3AmountsForLiquidity, getV3LiquidityDistribution, mintV3, loading } = useSwapContext();
  const { fetchUsdstBalance } = useTokenContext();
  const { activeTokens, inactiveTokens, fetchTokens } = useUserTokens();
  const { isLoggedIn } = useUser();
  const { toast } = useToast();

  const currentPrice = Number(BigInt(pool.priceWad)) / 1e18;
  // pinned at the tick-domain edge = one side of the pool was drained; the "price"
  // is the domain ceiling/floor, so anchoring ranges to it produces nonsense
  const priceEdge = priceDomainEdge(pool);

  // Value-weighted composition of the pool's holdings: both balances valued in
  // token1 terms via the oracle pair price (falling back to the pool price), so
  // the proportions compare value, not raw token counts. Makes a drained /
  // one-sided pool visible at a glance.
  const composition = useMemo(() => {
    try {
      const bal0 = BigInt(pool.token0Balance);
      const bal1 = BigInt(pool.token1Balance);
      if (bal0 === 0n && bal1 === 0n) return null;
      const oracleWad = BigInt(pool.oraclePriceWad || "0");
      const pairPriceWad = oracleWad > 0n ? oracleWad : BigInt(pool.priceWad);
      const value0 = (bal0 * pairPriceWad) / 10n ** 18n;
      const total = value0 + bal1;
      if (total === 0n) return null;
      const pct0 = Number((value0 * 10000n) / total) / 100;
      return { pct0, pct1: 100 - pct0 };
    } catch {
      return null;
    }
  }, [pool.token0Balance, pool.token1Balance, pool.oraclePriceWad, pool.priceWad]);

  const [tickLower, setTickLower] = useState<number | null>(null);
  const [tickUpper, setTickUpper] = useState<number | null>(null);
  const [priceLowerInput, setPriceLowerInput] = useState("");
  const [priceUpperInput, setPriceUpperInput] = useState("");
  const [amountField, setAmountField] = useState<"amount0" | "amount1">("amount0");
  const [amountInput, setAmountInput] = useState("");
  const [preview, setPreview] = useState<PoolV3AmountsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [liquidityDist, setLiquidityDist] = useState<PoolV3LiquidityDistribution | null>(null);
  const [liquidityDistLoading, setLiquidityDistLoading] = useState(false);

  // Liquidity depth data for the range picker; pool.liquidity in the deps refreshes
  // the chart when the pool state updates (e.g. after our own mint)
  useEffect(() => {
    const controller = new AbortController();
    setLiquidityDistLoading(true);
    getV3LiquidityDistribution(pool.address, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setLiquidityDist(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLiquidityDistLoading(false);
      });
    return () => controller.abort();
  }, [pool.address, pool.liquidity, getV3LiquidityDistribution]);

  const rangeValid = tickLower !== null && tickUpper !== null && tickLower < tickUpper;
  const inRange =
    tickLower !== null && tickUpper !== null && pool.currentTick >= tickLower && pool.currentTick < tickUpper;
  // Which token(s) an in/out-of-range position actually consumes, so we can steer the input.
  const needsToken0 = !rangeValid || pool.currentTick < tickUpper!; // token0 unless price is above the range
  const needsToken1 = !rangeValid || pool.currentTick >= tickLower!; // token1 unless price is below the range
  const previewZero = preview !== null && BigInt(preview.liquidity) === 0n;

  // User balances (wei) of the pool tokens, for the Max button and deposit validation
  const [balance0, balance1] = useMemo(() => {
    const balanceOf = (tokenAddress: string): bigint => {
      const addr = tokenAddress.toLowerCase();
      const entry = [...activeTokens, ...inactiveTokens].find((t) => t.address?.toLowerCase() === addr);
      try {
        return BigInt(entry?.balance || "0");
      } catch {
        return 0n;
      }
    };
    return [balanceOf(pool.token0.address), balanceOf(pool.token1.address)];
  }, [activeTokens, inactiveTokens, pool.token0.address, pool.token1.address]);

  const confirmRows: ConfirmRow[] =
    preview && rangeValid
      ? [
        { label: "Pool", value: `${pool.token0.symbol}/${pool.token1.symbol} · ${pool.fee / 10000}%` },
        {
          label: "Range",
          value: `${formatTickAsPrice(preview.tickLower)} – ${formatTickAsPrice(preview.tickUpper)} ${pool.token1.symbol}/${pool.token0.symbol}`,
        },
        {
          label: "Deposit",
          value:
            describePoolAmounts(pool, { amount0: BigInt(preview.amount0), amount1: BigInt(preview.amount1) }) ?? "0",
        },
      ]
      : [];

  const enteredSymbol = amountField === "amount0" ? pool.token0.symbol : pool.token1.symbol;
  const enteredDecimals = amountField === "amount0" ? pool.token0.decimals : pool.token1.decimals;
  const enteredBalance = amountField === "amount0" ? balance0 : balance1;

  // Tokens the deposit would overdraw. The preview knows both final amounts (an in-range
  // deposit consumes the counterpart token too); before it lands, at least check the token
  // being typed. Skipped when logged out — there are no balances to check against.
  const insufficientTokens = useMemo(() => {
    if (!isLoggedIn || !rangeValid) return [];
    const short = new Set<string>();
    if (safeParseUnits(amountInput || "0") > enteredBalance) short.add(enteredSymbol);
    if (preview && !previewZero) {
      if (BigInt(preview.amount0) > balance0) short.add(pool.token0.symbol);
      if (BigInt(preview.amount1) > balance1) short.add(pool.token1.symbol);
    }
    return [...short];
  }, [isLoggedIn, rangeValid, amountInput, enteredBalance, enteredSymbol, preview, previewZero, balance0, balance1, pool.token0.symbol, pool.token1.symbol]);

  // Reset the form when the pool changes; also drop the previous pool's liquidity
  // distribution so the chart shows the skeleton instead of stale depth data
  useEffect(() => {
    setTickLower(null);
    setTickUpper(null);
    setPriceLowerInput("");
    setPriceUpperInput("");
    setAmountInput("");
    setPreview(null);
    setLiquidityDist(null);
  }, [pool.address]);

  // Keep the entered token valid for the selected range: a range entirely above the price
  // takes only token0, one entirely below takes only token1. Auto-steer so the user can't
  // enter the token the position won't use (which would derive zero liquidity).
  useEffect(() => {
    if (!rangeValid) return;
    if (amountField === "amount1" && !needsToken1) setAmountField("amount0");
    if (amountField === "amount0" && !needsToken0) setAmountField("amount1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickLower, tickUpper]);

  const applyPriceBound = (isLower: boolean, value: string) => {
    if (isLower) setPriceLowerInput(value);
    else setPriceUpperInput(value);
    // commas are thousands separators ("1,500"), not decimals — parseFloat would stop at one
    const price = parseFloat(value.replace(/,/g, ""));
    if (!isFinite(price) || price <= 0) {
      if (isLower) setTickLower(null);
      else setTickUpper(null);
      return;
    }
    const tick = snapTick(priceToTick(price), pool.tickSpacing);
    if (isLower) setTickLower(tick);
    else setTickUpper(tick);
  };

  const applyTicks = (tl: number, tu: number) => {
    setTickLower(tl);
    setTickUpper(tu);
    setPriceLowerInput(tickToPriceInput(tl));
    setPriceUpperInput(tickToPriceInput(tu));
  };

  const clearRange = () => {
    setTickLower(null);
    setTickUpper(null);
    setPriceLowerInput("");
    setPriceUpperInput("");
  };

  const applyPreset = (lowerPct: number, upperPct: number) => {
    if (!isFinite(currentPrice) || currentPrice <= 0 || priceEdge) return;
    // A 0 bound anchors that side at the current tick, snapped so the range sits entirely
    // on one side of the price and deposits a single token: a below-price range ends at
    // the spacing-floor of the current tick, an above-price range starts at its ceiling.
    let tl = lowerPct === 0
      ? snapTick(Math.ceil(pool.currentTick / pool.tickSpacing) * pool.tickSpacing, pool.tickSpacing)
      : snapTick(priceToTick(currentPrice * (1 + lowerPct)), pool.tickSpacing);
    let tu = upperPct === 0
      ? snapTick(Math.floor(pool.currentTick / pool.tickSpacing) * pool.tickSpacing, pool.tickSpacing)
      : snapTick(priceToTick(currentPrice * (1 + upperPct)), pool.tickSpacing);
    // A preset narrower than one tick spacing (e.g. Stable ±0.03% on a 10-spacing tier)
    // collapses when snapped — fall back to the tightest expressible range that still
    // straddles the current price: one spacing wide, floor-aligned to the current tick.
    if (lowerPct < 0 && upperPct > 0 && tl >= tu) {
      tl = snapTick(Math.floor(pool.currentTick / pool.tickSpacing) * pool.tickSpacing, pool.tickSpacing);
      tu = snapTick(tl + pool.tickSpacing, pool.tickSpacing);
    }
    applyTicks(tl, tu);
  };

  const cancelPendingPreview = () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewAbortRef.current?.abort();
  };

  // Debounced amounts preview via the backend (exact on-chain math)
  const refreshPreview = useCallback(
    (amount: string, field: "amount0" | "amount1", lo: number, hi: number) => {
      cancelPendingPreview();
      // Drop the stale preview BEFORE the debounce timer: previewLoading gates the
      // submit button, so leaving the old preview submittable during the 350ms window
      // would let a quick click mint at the previous input's amounts.
      setPreview(null);
      setPreviewLoading(true);
      previewTimerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        try {
          const wei = safeParseUnits(amount);
          if (wei === 0n) {
            setPreview(null);
            return;
          }
          const result = await getV3AmountsForLiquidity(
            pool.address,
            lo,
            hi,
            field === "amount0" ? { amount0Desired: wei.toString() } : { amount1Desired: wei.toString() },
            controller.signal
          );
          if (!controller.signal.aborted) setPreview(result);
        } catch (err) {
          if (err?.name !== "CanceledError" && err?.code !== "ERR_CANCELED") console.error(err);
        } finally {
          // an aborted call was superseded — its successor owns previewLoading now
          if (!controller.signal.aborted) setPreviewLoading(false);
        }
      }, 350);
    },
    [getV3AmountsForLiquidity, pool.address]
  );

  const handleAmountChange = (value: string) => {
    setAmountInput(value);
    if (!rangeValid || !value || isNaN(Number(value))) {
      cancelPendingPreview();
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    refreshPreview(value, amountField, tickLower!, tickUpper!);
  };

  const handleMaxClick = () => {
    if (enteredBalance === 0n) return;
    handleAmountChange(formatUnits(enteredBalance.toString()));
  };

  // Re-preview when the range or entered token changes with an amount already entered
  useEffect(() => {
    if (rangeValid && amountInput && !isNaN(Number(amountInput))) {
      refreshPreview(amountInput, amountField, tickLower!, tickUpper!);
    } else {
      cancelPendingPreview(); // a pending preview would resolve for the abandoned range
      setPreview(null);
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickLower, tickUpper, amountField]);

  const handleMint = async () => {
    if (!preview || !rangeValid || previewZero) return;
    try {
      // Positions are minted as NFTs via PositionManagerV3: the desired amounts are the
      // deposit ceilings (the manager recomputes liquidity from them at the execution
      // price and never pulls more), the mins guard against an adverse price move.
      const withSlippage = (amount: string) =>
        ((BigInt(amount) * (10000n - MINT_SLIPPAGE_BPS)) / 10000n).toString();
      const res = await mintV3({
        poolAddress: pool.address,
        tickLower: preview.tickLower,
        tickUpper: preview.tickUpper,
        amount0Desired: preview.amount0,
        amount1Desired: preview.amount1,
        amount0Min: BigInt(preview.amount0) > 0n ? withSlippage(preview.amount0) : "0",
        amount1Min: BigInt(preview.amount1) > 0n ? withSlippage(preview.amount1) : "0",
      });
      // mint() returns the exact amounts the pool took, which can differ slightly from the preview
      const amounts = poolV3TxAmounts(res);
      const deposited = amounts ? describePoolAmounts(pool, amounts) : null;
      toast({
        title: "Position created",
        description: deposited
          ? `Deposited ${deposited} into ${pool.token0.symbol}/${pool.token1.symbol} (${pool.fee / 10000}%)`
          : `Added liquidity to ${pool.token0.symbol}/${pool.token1.symbol} (${pool.fee / 10000}%)`,
        variant: "success",
      });
      setAmountInput("");
      setPreview(null);
      clearRange(); // fresh slate for the next position; the chart recenters on the pool
      fetchTokens(); // deposit changed the wallet balances shown next to Max
      fetchUsdstBalance(); // USDST balance box: deposit side and/or the gas fee
      onMinted();
    } catch (err) {
      toast({
        title: "Mint failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const confirmMint = async () => {
    try {
      await handleMint();
    } finally {
      setConfirmOpen(false);
    }
  };

  // Progressive, self-explaining button label so the user always knows the next step.
  const buttonLabel = pool.isDisabled
    ? "Pool is disabled"
    : pool.isPaused
      ? "Pool is paused"
      : !rangeValid
        ? "Enter a price range"
        : !amountInput || safeParseUnits(amountInput) === 0n
          ? "Enter an amount"
          : insufficientTokens.length > 0
            ? `Insufficient ${insufficientTokens[0]} balance`
            : previewLoading
              ? "Calculating…"
              : previewZero
                ? "Amount too small"
                : "Add Liquidity";

  const canMint =
    !loading && !previewLoading && !!preview && !previewZero && rangeValid &&
    insufficientTokens.length === 0 && !pool.isPaused && !pool.isDisabled;

  return (
    <div className="bg-card shadow-sm rounded-xl p-4 border border-border space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New position</h3>
      </div>

      {/* Pool composition: value-weighted share of each token currently held by the pool */}
      {composition && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Pool composition</span>
          {/* token1 left / token0 right, matching the liquidity chart's price-axis sides */}
          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
            <div className="bg-amber-500" style={{ width: `${composition.pct1}%` }} />
            <div className="bg-strato-blue" style={{ width: `${composition.pct0}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="truncate">
                {formatTokenAmount(pool.token1Balance, pool.token1.decimals)} {pool.token1.symbol} ({composition.pct1.toFixed(1)}%)
              </span>
            </span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-strato-blue flex-shrink-0" />
              <span className="truncate">
                {formatTokenAmount(pool.token0Balance, pool.token0.decimals)} {pool.token0.symbol} ({composition.pct0.toFixed(1)}%)
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Price range (token1 per token0) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Price range ({pool.token1.symbol} per {pool.token0.symbol})
          </span>
        </div>

        {/* One-click range strategies around the current price */}
        <div className="grid grid-cols-5 gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.lowerPct, p.upperPct)}
              disabled={!isFinite(currentPrice) || currentPrice <= 0 || priceEdge !== null}
              className="px-2 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <div className="text-[11px] font-medium">{p.label}</div>
              <div className="text-[10px] opacity-70">{p.hint}</div>
            </button>
          ))}
        </div>

        {/* Where the pool's liquidity sits on the price axis; drag the handles/band to set the range */}
        <V3LiquidityChart
          distribution={liquidityDist}
          loading={liquidityDistLoading}
          tickLower={tickLower}
          tickUpper={tickUpper}
          onRangeChange={applyTicks}
          onRangeClear={clearRange}
          token0Symbol={pool.token0.symbol}
          token1Symbol={pool.token1.symbol}
        />
        {priceEdge && (
          <p className="text-xs text-yellow-600">
            The pool's {priceEdge === "max" ? pool.token0.symbol : pool.token1.symbol} side was fully bought
            out, so its price sits at the tick-domain {priceEdge === "max" ? "ceiling" : "floor"} and the
            percentage presets would anchor to it. Enter explicit Min/Max prices around the real market
            price instead — new in-range liquidity is also what lets the pool re-price itself.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/50 rounded-lg border border-border p-2.5">
            <label className="text-[11px] text-muted-foreground">Min price</label>
            <Input
              value={priceLowerInput}
              onChange={(e) => applyPriceBound(true, e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="h-8 border-none bg-transparent px-0 text-sm font-medium focus-visible:ring-0"
            />
            {tickLower !== null && (
              <span className="text-[11px] text-muted-foreground">tick {tickLower}</span>
            )}
          </div>
          <div className="bg-muted/50 rounded-lg border border-border p-2.5">
            <label className="text-[11px] text-muted-foreground">Max price</label>
            <Input
              value={priceUpperInput}
              onChange={(e) => applyPriceBound(false, e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="h-8 border-none bg-transparent px-0 text-sm font-medium focus-visible:ring-0"
            />
            {tickUpper !== null && (
              <span className="text-[11px] text-muted-foreground">tick {tickUpper}</span>
            )}
          </div>
        </div>
        {tickLower !== null && tickUpper !== null && tickLower >= tickUpper && (
          <p className="text-xs text-red-600">Min price must be below max price</p>
        )}
        {rangeValid && inRange && (
          <p className="text-xs text-green-600">
            Range spans the current price — deposits both tokens and earns fees now.
          </p>
        )}
        {rangeValid && !inRange && (
          <p className="text-xs text-yellow-600">
            Range is entirely {pool.currentTick < tickLower! ? "above" : "below"} the current price — deposits only{" "}
            {needsToken0 ? pool.token0.symbol : pool.token1.symbol} and earns no fees until the price enters the range.
          </p>
        )}
      </div>

      {/* Deposit amount */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Deposit amount</span>
          {inRange && (
            <div className="flex gap-1">
              {(["amount0", "amount1"] as const).map((field) => (
                <button
                  key={field}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border border-border ${amountField === field ? "bg-muted text-foreground" : "text-muted-foreground"
                    }`}
                  onClick={() => {
                    setAmountField(field);
                  }}
                >
                  {field === "amount0" ? pool.token0.symbol : pool.token1.symbol}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <Input
            value={amountInput}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            disabled={!rangeValid}
            className="h-10 text-sm pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
            {enteredSymbol}
          </span>
        </div>
        {isLoggedIn && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Balance: {formatTokenAmount(enteredBalance, enteredDecimals)} {enteredSymbol}
            </span>
            <button
              type="button"
              onClick={handleMaxClick}
              disabled={!rangeValid || enteredBalance === 0n}
              className="text-blue-600 underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Max
            </button>
          </div>
        )}
        {insufficientTokens.length > 0 && (
          <p className="text-xs text-red-600">
            Insufficient {insufficientTokens.join(" and ")} balance — you can deposit at most what your wallet holds.
          </p>
        )}
        {inRange && (
          <p className="text-[11px] text-muted-foreground">
            Enter one token — the matching amount of the other is calculated automatically.
          </p>
        )}
      </div>

      {/* Preview: the actual amounts deposited on-chain */}
      {preview && !previewZero && (
        <div className="bg-muted/50 rounded-lg border border-border p-3 space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{pool.token0.symbol} deposited</span>
            <span className="font-medium">{formatTokenAmount(preview.amount0, pool.token0.decimals)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{pool.token1.symbol} deposited</span>
            <span className="font-medium">{formatTokenAmount(preview.amount1, pool.token1.decimals)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 mt-1">
            <span className="text-muted-foreground">Liquidity</span>
            <span className="font-medium">{formatUnits(preview.liquidity)}</span>
          </div>
        </div>
      )}

      <Button
        className="w-full bg-strato-blue hover:bg-strato-blue/90"
        onClick={() => setConfirmOpen(true)}
        disabled={!canMint}
      >
        {buttonLabel}
      </Button>

      <V3ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Add liquidity"
        rows={confirmRows}
        warning={
          rangeValid && !inRange
            ? `The range is entirely ${pool.currentTick < (tickLower ?? 0) ? "above" : "below"} the current price — the position earns no fees until the price enters the range.`
            : undefined
        }
        confirmLabel="Add Liquidity"
        onConfirm={confirmMint}
        loading={loading}
      />
    </div>
  );
};

export default V3NewPositionCard;

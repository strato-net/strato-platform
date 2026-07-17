import { useCallback, useEffect, useRef, useState } from "react";
import { PoolV3, PoolV3AmountsPreview } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import {
  priceToTick,
  snapTick,
  fullRangeTicks,
  formatTickAsPrice,
  formatPriceWad,
  formatTokenAmount,
} from "./poolV3Utils";

const MINT_SLIPPAGE_BPS = 100n; // 1% headroom on the amount maxes

// One-click range presets, as +/- percentage bands around the current price.
const RANGE_PRESETS = [
  { label: "±10%", pct: 0.1 },
  { label: "±20%", pct: 0.2 },
  { label: "±50%", pct: 0.5 },
];

interface V3NewPositionCardProps {
  pool: PoolV3;
  onMinted: () => void;
}

const V3NewPositionCard = ({ pool, onMinted }: V3NewPositionCardProps) => {
  const { getV3AmountsForLiquidity, mintV3, loading } = useSwapContext();
  const { toast } = useToast();

  const currentPrice = Number(BigInt(pool.priceWad)) / 1e18;

  const [tickLower, setTickLower] = useState<number | null>(null);
  const [tickUpper, setTickUpper] = useState<number | null>(null);
  const [priceLowerInput, setPriceLowerInput] = useState("");
  const [priceUpperInput, setPriceUpperInput] = useState("");
  const [amountField, setAmountField] = useState<"amount0" | "amount1">("amount0");
  const [amountInput, setAmountInput] = useState("");
  const [preview, setPreview] = useState<PoolV3AmountsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rangeValid = tickLower !== null && tickUpper !== null && tickLower < tickUpper;
  const inRange =
    tickLower !== null && tickUpper !== null && pool.currentTick >= tickLower && pool.currentTick < tickUpper;
  // Which token(s) an in/out-of-range position actually consumes, so we can steer the input.
  const needsToken0 = !rangeValid || pool.currentTick < tickUpper!; // token0 unless price is above the range
  const needsToken1 = !rangeValid || pool.currentTick >= tickLower!; // token1 unless price is below the range
  const previewZero = preview !== null && BigInt(preview.liquidity) === 0n;

  // Reset the form when the pool changes
  useEffect(() => {
    setTickLower(null);
    setTickUpper(null);
    setPriceLowerInput("");
    setPriceUpperInput("");
    setAmountInput("");
    setPreview(null);
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
    const price = parseFloat(value);
    if (!isFinite(price) || price <= 0) {
      if (isLower) setTickLower(null);
      else setTickUpper(null);
      return;
    }
    const tick = snapTick(priceToTick(price), pool.tickSpacing);
    if (isLower) setTickLower(tick);
    else setTickUpper(tick);
  };

  const applyRange = (lo: number, hi: number) => {
    const tl = snapTick(priceToTick(lo), pool.tickSpacing);
    const tu = snapTick(priceToTick(hi), pool.tickSpacing);
    setTickLower(tl);
    setTickUpper(tu);
    setPriceLowerInput(formatTickAsPrice(tl));
    setPriceUpperInput(formatTickAsPrice(tu));
  };

  const applyPreset = (pct: number) => {
    if (!isFinite(currentPrice) || currentPrice <= 0) return;
    applyRange(currentPrice * (1 - pct), currentPrice * (1 + pct));
  };

  const applyFullRange = () => {
    const { tickLower: lo, tickUpper: hi } = fullRangeTicks(pool.tickSpacing);
    setTickLower(lo);
    setTickUpper(hi);
    setPriceLowerInput(formatTickAsPrice(lo));
    setPriceUpperInput(formatTickAsPrice(hi));
  };

  // Debounced amounts preview via the backend (exact on-chain math)
  const refreshPreview = useCallback(
    (amount: string, field: "amount0" | "amount1", lo: number, hi: number) => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      previewAbortRef.current?.abort();
      previewTimerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        setPreviewLoading(true);
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
          setPreviewLoading(false);
        }
      }, 350);
    },
    [getV3AmountsForLiquidity, pool.address]
  );

  const handleAmountChange = (value: string) => {
    setAmountInput(value);
    if (!rangeValid || !value || isNaN(Number(value))) {
      setPreview(null);
      return;
    }
    refreshPreview(value, amountField, tickLower!, tickUpper!);
  };

  // Re-preview when the range or entered token changes with an amount already entered
  useEffect(() => {
    if (rangeValid && amountInput && !isNaN(Number(amountInput))) {
      refreshPreview(amountInput, amountField, tickLower!, tickUpper!);
    } else {
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickLower, tickUpper, amountField]);

  const handleMint = async () => {
    if (!preview || !rangeValid || previewZero) return;
    try {
      const withSlippage = (amount: string) =>
        ((BigInt(amount) * (10000n + MINT_SLIPPAGE_BPS)) / 10000n).toString();
      await mintV3({
        poolAddress: pool.address,
        tickLower: preview.tickLower,
        tickUpper: preview.tickUpper,
        liquidity: preview.liquidity,
        amount0Max: BigInt(preview.amount0) > 0n ? withSlippage(preview.amount0) : "0",
        amount1Max: BigInt(preview.amount1) > 0n ? withSlippage(preview.amount1) : "0",
      });
      toast({
        title: "Position created",
        description: `Added liquidity to ${pool.token0.symbol}/${pool.token1.symbol} (${pool.fee / 10000}%)`,
        variant: "success",
      });
      setAmountInput("");
      setPreview(null);
      onMinted();
    } catch (err) {
      toast({
        title: "Mint failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const enteredSymbol = amountField === "amount0" ? pool.token0.symbol : pool.token1.symbol;

  // Progressive, self-explaining button label so the user always knows the next step.
  const buttonLabel = pool.isDisabled
    ? "Pool is disabled"
    : pool.isPaused
      ? "Pool is paused"
      : !rangeValid
        ? "Enter a price range"
        : !amountInput || safeParseUnits(amountInput) === 0n
          ? "Enter an amount"
          : previewLoading
            ? "Calculating…"
            : previewZero
              ? "Amount too small"
              : "Add Liquidity";

  const canMint =
    !loading && !previewLoading && !!preview && !previewZero && rangeValid && !pool.isPaused && !pool.isDisabled;

  return (
    <div className="bg-card shadow-sm rounded-xl p-4 border border-border space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New position</h3>
        <span className="text-xs text-muted-foreground">
          Current: 1 {pool.token0.symbol} ≈ {formatPriceWad(pool.priceWad)} {pool.token1.symbol}
        </span>
      </div>

      {/* Price range (token1 per token0) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Price range ({pool.token1.symbol} per {pool.token0.symbol})
          </span>
        </div>

        {/* One-click presets around the current price */}
        <div className="flex gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.pct)}
              disabled={!isFinite(currentPrice) || currentPrice <= 0}
              className="flex-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={applyFullRange}
            className="flex-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Full
          </button>
        </div>

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
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border border-border ${
                    amountField === field ? "bg-muted text-foreground" : "text-muted-foreground"
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
        onClick={handleMint}
        disabled={!canMint}
      >
        {buttonLabel}
      </Button>
    </div>
  );
};

export default V3NewPositionCard;

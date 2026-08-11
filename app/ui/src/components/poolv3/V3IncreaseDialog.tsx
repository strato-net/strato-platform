import { useCallback, useEffect, useRef, useState } from "react";
import { PoolV3, PoolV3AmountsPreview, PoolV3Position } from "@/interface";
import { useSwapContext } from "@/context/SwapContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatTokenAmount, formatTickAsPrice, poolV3TxAmounts, describePoolAmounts } from "./poolV3Utils";

const INCREASE_SLIPPAGE_BPS = 100n; // 1% downward tolerance on the amount minimums

interface V3IncreaseDialogProps {
  /** the position NFT receiving the liquidity (kind "nft" only) */
  position: PoolV3Position;
  pool: PoolV3;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIncreased: () => void;
}

/**
 * Add liquidity to an existing position NFT, keeping its range. Same enter-one-token,
 * preview-both-amounts flow as V3NewPositionCard, addressed by tokenId.
 */
const V3IncreaseDialog = ({ position, pool, open, onOpenChange, onIncreased }: V3IncreaseDialogProps) => {
  const { getV3AmountsForLiquidity, increaseV3, loading } = useSwapContext();
  const { toast } = useToast();

  const [amountField, setAmountField] = useState<"amount0" | "amount1">("amount0");
  const [amountInput, setAmountInput] = useState("");
  const [preview, setPreview] = useState<PoolV3AmountsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which token(s) the range consumes at the current price, to steer the input
  const needsToken0 = pool.currentTick < position.tickUpper;
  const needsToken1 = pool.currentTick >= position.tickLower;
  const inRange = needsToken0 && needsToken1;
  const previewZero = preview !== null && BigInt(preview.liquidity) === 0n;

  useEffect(() => {
    if (!open) return;
    setAmountInput("");
    setPreview(null);
    setAmountField(needsToken0 ? "amount0" : "amount1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refreshPreview = useCallback(
    (amount: string, field: "amount0" | "amount1") => {
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
            position.poolAddress,
            position.tickLower,
            position.tickUpper,
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
    [getV3AmountsForLiquidity, position.poolAddress, position.tickLower, position.tickUpper]
  );

  const handleAmountChange = (value: string) => {
    setAmountInput(value);
    if (!value || isNaN(Number(value))) {
      setPreview(null);
      return;
    }
    refreshPreview(value, amountField);
  };

  const handleIncrease = async () => {
    if (!preview || previewZero || position.tokenId === undefined) return;
    try {
      const withSlippage = (amount: string) =>
        ((BigInt(amount) * (10000n - INCREASE_SLIPPAGE_BPS)) / 10000n).toString();
      const res = await increaseV3({
        tokenId: position.tokenId,
        amount0Desired: preview.amount0,
        amount1Desired: preview.amount1,
        amount0Min: BigInt(preview.amount0) > 0n ? withSlippage(preview.amount0) : "0",
        amount1Min: BigInt(preview.amount1) > 0n ? withSlippage(preview.amount1) : "0",
      });
      const amounts = poolV3TxAmounts(res);
      const deposited = amounts ? describePoolAmounts(pool, amounts) : null;
      toast({
        title: "Liquidity added",
        description: deposited
          ? `Deposited ${deposited} into position #${position.tokenId}`
          : `Added liquidity to position #${position.tokenId}`,
        variant: "success",
      });
      onOpenChange(false);
      onIncreased();
    } catch (err) {
      toast({
        title: "Increase failed",
        description: err.response?.data?.message || err.message || "Transaction failed",
        variant: "destructive",
      });
    }
  };

  const enteredSymbol = amountField === "amount0" ? pool.token0.symbol : pool.token1.symbol;
  const canIncrease = !loading && !previewLoading && !!preview && !previewZero;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg md:text-xl">Add liquidity to #{position.tokenId}</DialogTitle>
          <DialogDescription className="text-xs md:text-sm">
            Range {formatTickAsPrice(position.tickLower)} – {formatTickAsPrice(position.tickUpper)}{" "}
            {pool.token1.symbol}/{pool.token0.symbol} · fees accrue to this position's holder.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
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
                      if (amountInput && !isNaN(Number(amountInput))) refreshPreview(amountInput, field);
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
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            disabled={!canIncrease}
            onClick={handleIncrease}
            className="w-full sm:w-auto bg-strato-blue hover:bg-strato-blue/90"
          >
            {loading && (
              <span className="inline-flex items-center animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-current mr-2" />
            )}
            {previewLoading ? "Calculating…" : previewZero ? "Amount too small" : "Add liquidity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default V3IncreaseDialog;

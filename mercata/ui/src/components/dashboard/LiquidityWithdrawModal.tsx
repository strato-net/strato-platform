import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSwapContext } from "@/context/SwapContext";
import { WITHDRAW_FEE, DECIMALS, VOUCHERS_PER_UNIT } from "@/lib/constants";
import { LiquidityPool } from "@/interface";
import { formatBalance, fmt, safeParseUnits, formatUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/validationUtils";
import { Balances } from "@/context/UserTokensContext";
import TokenInput from "@/components/shared/TokenInput";

interface LiquidityWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onWithdrawSuccess: () => Promise<void>;
  operationInProgressRef: React.MutableRefObject<boolean>;
  balances: Balances;
}

const LiquidityWithdrawModal = ({
  isOpen,
  onClose,
  selectedPool,
  onWithdrawSuccess,
  operationInProgressRef,
  balances,
}: LiquidityWithdrawModalProps) => {
  // ============================================================================
  // HOOKS & CONTEXT
  // ============================================================================
  const { removeLiquidity } = useSwapContext();
  const { toast } = useToast();

  // ============================================================================
  // STATE
  // ============================================================================
  const [withdrawPercent, setWithdrawPercent] = useState("");
  const [withdrawPercentError, setWithdrawPercentError] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  // Pool view object
  const poolView = useMemo(() => {
    if (!selectedPool) return null;
    return {
      name: selectedPool._name,
      symbol: selectedPool._symbol ?? "LP",
      lpBal: BigInt(selectedPool.lpToken?.balances?.[0]?.balance ?? "0"),
      total: BigInt(selectedPool.lpToken?._totalSupply ?? "0"),
      a: BigInt(selectedPool.tokenABalance ?? "0"),
      b: BigInt(selectedPool.tokenBBalance ?? "0"),
    };
  }, [selectedPool]);

  // Derive token names from pool name
  const nameParts = poolView?.name?.split("/") ?? [];
  const tokenAName = nameParts[0] ?? "Token A";
  const tokenBName = nameParts[1] ?? "Token B";

  // Parse and validate withdraw percentage
  const rawPct = Number(withdrawPercent) || 0;
  const clampedPct = Math.max(0, Math.min(100, rawPct));
  const pct = BigInt(Math.floor(clampedPct));
  const hasValidPercent = clampedPct > 0;

  // User position calculation
  const position = useMemo(() => {
    if (!poolView || poolView.total === 0n || poolView.lpBal === 0n)
      return { a: 0n, b: 0n };
    return {
      a: (poolView.lpBal * poolView.a) / poolView.total,
      b: (poolView.lpBal * poolView.b) / poolView.total,
    };
  }, [poolView]);

  // Withdraw amounts
  const lpToBurn = hasValidPercent && poolView ? (poolView.lpBal * pct) / 100n : 0n;
  const outA = hasValidPercent ? (position.a * pct) / 100n : 0n;
  const outB = hasValidPercent ? (position.b * pct) / 100n : 0n;

  // Fee math
  const feeWei = safeParseUnits(WITHDRAW_FEE, DECIMALS);
  const vouchersRequired = Math.round(Number(WITHDRAW_FEE) * VOUCHERS_PER_UNIT);
  const availableVoucherCount = Math.floor(
    Number(formatUnits(balances.voucher, DECIMALS)) * VOUCHERS_PER_UNIT
  );

  // Fee gating
  const canPayFee = (balances.usdst + balances.voucher) >= feeWei;
  const feeError = canPayFee ? null : "Insufficient USDST + vouchers for transaction fee";

  // Max transferable calculation
  const maxTransferable = useMemo(() => {
    if (!isOpen || !poolView) return 0n;
    return computeMaxTransferable(
      100n,
      null,
      WITHDRAW_FEE,
      balances.voucher,
      balances.usdst,
    );
  }, [isOpen, poolView, balances.usdst, balances.voucher]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleClose = useCallback(() => {
    setWithdrawPercent("");
    setWithdrawPercentError("");
    onClose();
  }, [onClose]);

  const handleWithdrawSubmit = async () => {
    if (
      !poolView ||
      operationInProgressRef.current ||
      withdrawLoading ||
      !hasValidPercent ||
      !canPayFee
    )
      return;

    operationInProgressRef.current = true;
    setWithdrawLoading(true);

    try {
      await removeLiquidity({
        poolAddress: selectedPool!.address,
        lpTokenAmount: lpToBurn.toString(),
      });

      toast({
        title: "Success",
        description: `Received ${fmt(outA, 18, 2, 6)} ${tokenAName} • ${fmt(outB, 18, 2, 6)} ${tokenBName}`,
        variant: "success",
      });

      handleClose();
    } finally {
      // Always call success callback and reset loading state, even if transaction fails
      await onWithdrawSuccess();
      setWithdrawLoading(false);
      operationInProgressRef.current = false;
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const canSubmit =
    !withdrawPercentError &&
    hasValidPercent &&
    poolView &&
    poolView.lpBal > 0n &&
    canPayFee &&
    !withdrawLoading;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
          <DialogDescription>
            Remove liquidity from the {selectedPool?._name} pool
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleWithdrawSubmit();
          }}
          className="space-y-4"
        >
          {/* Input Section */}
          <div className="grid grid-cols-1 gap-4 px-1">
            <TokenInput
              value={withdrawPercent}
              error={withdrawPercentError}
              tokenName="LP Token"
              tokenSymbol="%"
              maxTransferable={100n}
              decimals={0}
              disabled={!(poolView && poolView.lpBal > 0n) || !canPayFee}
              loading={withdrawLoading}
              onValueChange={setWithdrawPercent}
              onErrorChange={setWithdrawPercentError}
              onMaxClick={() => setWithdrawPercent("100")}
            />
          </div>

          {/* Position Information */}
          <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg space-y-2 mx-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">LP Tokens</span>
              <span className="font-medium">
                {formatBalance(
                  poolView?.lpBal ?? 0n,
                  poolView?.symbol ?? "LP",
                  18,
                  2,
                  6,
                )}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{tokenAName} position</span>
              <span className="font-medium">
                {hasValidPercent ? (
                  <span>
                    {fmt(position.a - outA, 18, 2, 6)}
                    <span className="text-green-600 ml-2">
                      (+{fmt(outA, 18, 2, 6)})
                    </span>
                  </span>
                ) : (
                  fmt(position.a, 18, 2, 6)
                )}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{tokenBName} position</span>
              <span className="font-medium">
                {hasValidPercent ? (
                  <span>
                    {fmt(position.b - outB, 18, 2, 6)}
                    <span className="text-green-600 ml-2">
                      (+{fmt(outB, 18, 2, 6)})
                    </span>
                  </span>
                ) : (
                  fmt(position.b, 18, 2, 6)
                )}
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">
                {WITHDRAW_FEE} USDST ({vouchersRequired} vouchers)
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Your vouchers</span>
              <span className="font-medium">
                {availableVoucherCount} vouchers
              </span>
            </div>
            {feeError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{feeError}</p>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2 px-1">
            <Button
              disabled={!canSubmit}
              type="submit"
              className="w-full bg-strato-blue hover:bg-strato-blue/90"
            >
              {withdrawLoading ? "Withdrawing..." : "Confirm Withdraw"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidityWithdrawModal;
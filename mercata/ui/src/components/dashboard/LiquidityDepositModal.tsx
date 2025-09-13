import { useState, useMemo } from "react";
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
import { DEPOSIT_FEE, SINGLE_TOKEN_DEPOSIT_FEE } from "@/lib/constants";
import { LiquidityPool } from "@/interface";
import { safeParseUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/validationUtils";
import { Balances } from "@/context/UserTokensContext";
import TokenInput from "@/components/shared/TokenInput";

const VOUCHERS_PER_UNIT = 100;

interface LiquidityDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onDepositSuccess: () => Promise<void>;
  operationInProgressRef: React.MutableRefObject<boolean>;
  balances: Balances;
}

const LiquidityDepositModal = ({
  isOpen,
  onClose,
  selectedPool,
  onDepositSuccess,
  operationInProgressRef,
  balances,
}: LiquidityDepositModalProps) => {
  // ============================================================================
  // STATE
  // ============================================================================
  const [token1Amount, setToken1Amount] = useState("");
  const [token1AmountError, setToken1AmountError] = useState("");
  const [token2Amount, setToken2Amount] = useState("");
  const [token2AmountError, setToken2AmountError] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);

  // ============================================================================
  // HOOKS & CONTEXT
  // ============================================================================
  const { addLiquidityDualToken, addLiquiditySingleToken } = useSwapContext();
  const { toast } = useToast();

  // Gate heavy work behind isOpen and pool
  const tokenAMaxAmount =
    isOpen && selectedPool
      ? BigInt(selectedPool.tokenA?.balances?.[0]?.balance ?? "0")
      : 0n;
  const tokenBMaxAmount =
    isOpen && selectedPool
      ? BigInt(selectedPool.tokenB?.balances?.[0]?.balance ?? "0")
      : 0n;
  const addrA = isOpen ? (selectedPool?.tokenA?.address ?? null) : null;
  const addrB = isOpen ? (selectedPool?.tokenB?.address ?? null) : null;
  const usdst = balances.usdst;
  const voucher = balances.voucher;

  // Memoize the 4 maxes with minimal deps
  const maxes = useMemo(() => {
    if (!isOpen || !selectedPool) return { aS: 0n, bS: 0n, aD: 0n, bD: 0n };
    return {
      aS: addrA
        ? computeMaxTransferable(
            tokenAMaxAmount,
            addrA,
            SINGLE_TOKEN_DEPOSIT_FEE,
            voucher,
            usdst,
          )
        : 0n,
      bS: addrB
        ? computeMaxTransferable(
            tokenBMaxAmount,
            addrB,
            SINGLE_TOKEN_DEPOSIT_FEE,
            voucher,
            usdst,
          )
        : 0n,
      aD: addrA
        ? computeMaxTransferable(
            tokenAMaxAmount,
            addrA,
            DEPOSIT_FEE,
            voucher,
            usdst,
          )
        : 0n,
      bD: addrB
        ? computeMaxTransferable(
            tokenBMaxAmount,
            addrB,
            DEPOSIT_FEE,
            voucher,
            usdst,
          )
        : 0n,
    };
  }, [isOpen, addrA, addrB, tokenAMaxAmount, tokenBMaxAmount, voucher, usdst]);

  // pick initial mode ONCE from real data; no temp
  const [depositMode, setDepositMode] = useState<"A" | "B" | "A&B">(() => {
    const canA = maxes.aS > 0n;
    const canB = maxes.bS > 0n;
    const canBmin = tokenBMaxAmount > 0n;
    return canA && canB ? "A&B" : canA ? "A" : canBmin ? "B" : "A&B";
  });

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  // Build poolView once for readability (gated by isOpen && selectedPool)
  const poolView =
    isOpen && selectedPool
      ? {
          nameA: selectedPool._name?.split("/")?.[0] ?? "Token A",
          nameB: selectedPool._name?.split("/")?.[1] ?? "Token B",
          decA: selectedPool.tokenA?.customDecimals ?? 18,
          decB: selectedPool.tokenB?.customDecimals ?? 18,
          ratioStr: Number.isFinite(Number(selectedPool.aToBRatio))
            ? Number(selectedPool.aToBRatio).toFixed(6)
            : "N/A",
        }
      : null;

  const maxA = depositMode === "A&B" ? maxes.aD : maxes.aS;
  const maxB = depositMode === "A&B" ? maxes.bD : maxes.bS;

  // Check if user can pay fees for current deposit mode
  const maxTransferable = depositMode === "A" ? maxA : depositMode === "B" ? maxB : 0;

  // Validation fee and voucher calculation
  const validationFee =
    depositMode === "A&B" ? DEPOSIT_FEE : SINGLE_TOKEN_DEPOSIT_FEE;
  const depositVouchersRequired = Math.round(
    Number(validationFee) * VOUCHERS_PER_UNIT,
  );

  // Get the fee error message from either TokenInput or proactive validation
  const feeError = token1AmountError?.includes(
    "Insufficient USDST + vouchers for transaction fee",
  )
    ? token1AmountError
    : token2AmountError?.includes(
          "Insufficient USDST + vouchers for transaction fee",
        )
      ? token2AmountError
      : maxTransferable === 0n
        ? "Insufficient USDST + vouchers for transaction fee"
        : null;

  // ============================================================================
  // UTILITIES
  // ============================================================================

  // Guarded setters to avoid redundant re-renders (e.g., when clicking Max sets same value)
  const setToken1AmountSafe = (v: string) =>
    setToken1Amount((prev) => (prev === v ? prev : v));
  const setToken2AmountSafe = (v: string) =>
    setToken2Amount((prev) => (prev === v ? prev : v));
  const setToken1ErrorSafe = (e: string) =>
    setToken1AmountError((prev) => (prev === e ? prev : e));
  const setToken2ErrorSafe = (e: string) =>
    setToken2AmountError((prev) => (prev === e ? prev : e));

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleClose = () => {
    setToken1Amount("");
    setToken2Amount("");
    setToken1AmountError("");
    setToken2AmountError("");
    onClose();
  };

  const isConfirmButtonDisabled =
    depositLoading ||
    !!token1AmountError ||
    !!token2AmountError ||
    (depositMode === "A" && !token1Amount) ||
    (depositMode === "B" && !token2Amount) ||
    (depositMode === "A&B" && (!token1Amount || !token2Amount));

  const handleDepositSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current) return;

    // Check for validation errors first
    if (token1AmountError || token2AmountError) {
      toast({
        title: "Error",
        description: "Please fix validation errors before proceeding",
        variant: "destructive",
      });
      return;
    }

    try {
      operationInProgressRef.current = true;
      setDepositLoading(true);
      
      if (depositMode === "A") {
        // Single token mode - Token A
        const token1AmountWei = safeParseUnits(
          token1Amount,
          poolView?.decA ?? 18,
        );
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token1AmountWei.toString(),
          isAToB: true,
        });
      } else if (depositMode === "B") {
        // Single token mode - Token B
        const token2AmountWei = safeParseUnits(
          token2Amount,
          poolView?.decB ?? 18,
        );
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token2AmountWei.toString(),
          isAToB: false,
        });
      } else {
        // Dual token mode
        const isInitialLiquidity =
          BigInt(selectedPool.lpToken._totalSupply) === BigInt(0);
        const aRaw = safeParseUnits(token1Amount || "0", poolView?.decA ?? 18);
        const tokenAAmount = isInitialLiquidity ? aRaw : (aRaw * 102n) / 100n; // 2% slippage using BigInt
        const tokenBAmount = safeParseUnits(
          token2Amount || "0",
          poolView?.decB ?? 18,
        );
        
        await addLiquidityDualToken({
          poolAddress: selectedPool.address,
          maxTokenAAmount: tokenAAmount.toString(),
          tokenBAmount: tokenBAmount.toString(),
        });
      }

      toast({
        title: "Success",
        description: `${selectedPool._name} deposited successfully.`,
        variant: "success",
      });

      handleClose();
      await onDepositSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setDepositLoading(false);
      operationInProgressRef.current = false;
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deposit Liquidity</DialogTitle>
          <DialogDescription>
            Add liquidity to the {selectedPool?._name} pool
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDepositSubmit();
          }}
          className="space-y-4"
        >
          {/* Mode Selection */}
          <div className="flex space-x-2 p-1">
            <Button
              type="button"
              variant={depositMode === "A" ? "default" : "outline"}
              size="sm"
              onClick={() => setDepositMode("A")}
              disabled={maxes.aS <= 0n}
              className="flex-1 text-xs"
            >
              {selectedPool?.tokenA?.symbol || poolView?.nameA} Only
            </Button>

            <Button
              type="button"
              variant={depositMode === "B" ? "default" : "outline"}
              size="sm"
              onClick={() => setDepositMode("B")}
              disabled={maxes.bS <= 0n}
              className="flex-1 text-xs"
            >
              {selectedPool?.tokenB?.symbol || poolView?.nameB} Only
            </Button>

            <Button
              type="button"
              variant={depositMode === "A&B" ? "default" : "outline"}
              size="sm"
              onClick={() => setDepositMode("A&B")}
              disabled={maxes.aD <= 0n || maxes.bD <= 0n}
              className="flex-1 text-xs"
            >
              Both Tokens
            </Button>
          </div>

          {/* Token Inputs */}
          <div className="grid grid-cols-1 gap-4 px-1">
            <TokenInput
              value={token1Amount}
              error={token1AmountError}
              tokenName={`${poolView?.nameA} Amount`}
              tokenSymbol={selectedPool?.tokenA?.symbol || poolView?.nameA}
              tokenAddress={selectedPool?.tokenA?.address || ""}
              maxAmount={tokenAMaxAmount}
              maxTransferable={maxA}
              transactionFee={validationFee}
              decimals={poolView?.decA ?? 18}
              disabled={maxA <= 0n || depositMode === "B"}
              loading={depositLoading}
              usdstBalance={usdst}
              voucherBalance={voucher}
              onValueChange={setToken1AmountSafe}
              onErrorChange={setToken1ErrorSafe}
            />

            <TokenInput
              value={token2Amount}
              error={token2AmountError}
              tokenName={`${poolView?.nameB} Amount`}
              tokenSymbol={selectedPool?.tokenB?.symbol || poolView?.nameB}
              tokenAddress={selectedPool?.tokenB?.address || ""}
              maxAmount={tokenBMaxAmount}
              maxTransferable={maxB}
              transactionFee={validationFee}
              decimals={poolView?.decB ?? 18}
              disabled={maxB <= 0n || depositMode === "A"}
              loading={depositLoading}
              usdstBalance={usdst}
              voucherBalance={voucher}
              onValueChange={setToken2AmountSafe}
              onErrorChange={setToken2ErrorSafe}
            />
          </div>

          {/* Pool Information */}
          <div className="rounded-lg bg-gray-50 p-4 mx-1">
            <h3 className="font-medium mb-4">Pool Information</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">APY</span>
                <span className="font-medium text-sm">
                  {selectedPool?.apy ? `${selectedPool.apy}%` : "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  Current pool ratio
                </span>
                <span className="font-medium text-sm text-right">
                  {selectedPool &&
                    `1 ${poolView?.nameA} = ${poolView?.ratioStr} ${poolView?.nameB}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Transaction fee</span>
                <span className="font-medium text-sm">
                  {validationFee} USDST ({depositVouchersRequired} vouchers
                  required)
                </span>
              </div>
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
              disabled={isConfirmButtonDisabled}
              type="submit"
              className="w-full bg-strato-blue hover:bg-strato-blue/90"
            >
              {depositLoading ? "Depositing..." : "Confirm Deposit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidityDepositModal;

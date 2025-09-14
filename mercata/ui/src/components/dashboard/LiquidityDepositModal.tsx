import { useState, useMemo, useEffect, useCallback } from "react";
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
import { DEPOSIT_FEE, SINGLE_TOKEN_DEPOSIT_FEE, DECIMALS, VOUCHERS_PER_UNIT } from "@/lib/constants";
import { LiquidityPool } from "@/interface";
import { safeParseUnits, formatUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/validationUtils";
import { Balances } from "@/context/UserTokensContext";
import TokenInput from "@/components/shared/TokenInput";

interface LiquidityDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onDepositSuccess: () => Promise<void>;
  operationInProgressRef: React.MutableRefObject<boolean>;
  balances: Balances;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const floorDiv = (x: bigint, y: bigint) => x / y;
const ceilDiv = (x: bigint, y: bigint) => (x + y - 1n) / y;

type Side = "A" | "B";
function canon(side: Side, X: bigint, RA: bigint, RB: bigint, aD: bigint, bD: bigint) {
  if (RA === 0n || RB === 0n) return { A: 0n, B: 0n };
  if (side === "A") {
    const aMaxByB = floorDiv(bD * RA, RB);         // Breq ≤ bD
    const A = min(X, min(aD, aMaxByB));
    const B = ceilDiv(A * RB, RA);
    return { A, B };
  } else {
    // Mirror on-chain rule when B is primary: A = floor(B*RA/RB) + 1
    // To ensure A ≤ aD after the +1, cap B by floor((aD-1)*RB/RA)
    const bMaxByA = aD > 0n ? floorDiv((aD - 1n) * RB, RA) : 0n; // ensures A<=aD
    const B = min(X, min(bD, bMaxByA));
    const A = floorDiv(B * RA, RB) + 1n; // exact contract mirror
    return { A, B };
  }
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
  // HOOKS & CONTEXT
  // ============================================================================
  const { addLiquidityDualToken, addLiquiditySingleToken } = useSwapContext();
  const { toast } = useToast();

  // ============================================================================
  // STATE
  // ============================================================================
  const [Astr, setAstr] = useState("");
  const [Bstr, setBstr] = useState("");
  const [token1AmountError, setToken1AmountError] = useState("");
  const [token2AmountError, setToken2AmountError] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);
  const [primary, setPrimary] = useState<"A" | "B">("A");

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  // Token balances (only compute when modal is open)
  const tokenAMaxAmount = useMemo(() => {
    if (!isOpen || !selectedPool) return 0n;
    const balance = selectedPool.tokenA?.balances?.[0]?.balance ?? "0";
    return BigInt(balance);
  }, [isOpen, selectedPool?.tokenA?.balances]);
  
  const tokenBMaxAmount = useMemo(() => {
    if (!isOpen || !selectedPool) return 0n;
    const balance = selectedPool.tokenB?.balances?.[0]?.balance ?? "0";
    return BigInt(balance);
  }, [isOpen, selectedPool?.tokenB?.balances]);

  const { usdst, voucher } = balances;

  // Pool view object - memoized from stable inputs
  const poolView = useMemo(() => {
    if (!isOpen || !selectedPool) return null;
    
    const [nameA = "", nameB = ""] = (selectedPool._name || "Token A/Token B").split("/");
    
    return {
      nameA,
      nameB,
      decA: 18, // Default to 18 decimals
      decB: 18, // Default to 18 decimals
      RA: BigInt(selectedPool.tokenABalance ?? "0"),
      RB: BigInt(selectedPool.tokenBBalance ?? "0"),
      lpTotalSupply: BigInt(selectedPool.lpToken?._totalSupply ?? "0"),
    };
  }, [isOpen, selectedPool?.address, selectedPool?.tokenABalance, selectedPool?.tokenBBalance, selectedPool?.lpToken?._totalSupply]);

  // Derived constants
  const decA = poolView?.decA ?? 18;
  const decB = poolView?.decB ?? 18;
  const isBootstrap = !!poolView && poolView.lpTotalSupply === 0n;
  
  // Minimum A needed for dual deposits (when pool has existing liquidity)
  const AMin = useMemo(() => {
    if (!poolView || isBootstrap) return 0n;
    return 1n + ceilDiv(poolView.RA, poolView.RB);
  }, [poolView, isBootstrap]);
  
  
  // Convert strings to wei when needed - memoized to avoid re-parsing
  const Awei = useMemo(() => safeParseUnits(Astr, decA), [Astr, decA]);
  const Bwei = useMemo(() => safeParseUnits(Bstr, decB), [Bstr, decB]);

  // Fee calculations
  const TEN_DEC = 10n ** BigInt(DECIMALS);
  const feeWeiDual = safeParseUnits(DEPOSIT_FEE, DECIMALS);
  const feeWeiSingle = safeParseUnits(SINGLE_TOKEN_DEPOSIT_FEE, DECIMALS);
  
  const vouchersRequiredDual = Math.round(Number((feeWeiDual * BigInt(VOUCHERS_PER_UNIT)) / TEN_DEC));
  const vouchersRequiredSingle = Math.round(Number((feeWeiSingle * BigInt(VOUCHERS_PER_UNIT)) / TEN_DEC));

  // Max transferable amounts (after fees)
  const maxes = useMemo(() => {
    if (!isOpen || !selectedPool) return { aS: 0n, bS: 0n, aD: 0n, bD: 0n };
    
    const addrA = selectedPool.tokenA?.address;
    const addrB = selectedPool.tokenB?.address;
    
    const aS = computeMaxTransferable(tokenAMaxAmount, addrA, SINGLE_TOKEN_DEPOSIT_FEE, voucher, usdst);
    const bS = computeMaxTransferable(tokenBMaxAmount, addrB, SINGLE_TOKEN_DEPOSIT_FEE, voucher, usdst);
    const aD = computeMaxTransferable(tokenAMaxAmount, addrA, DEPOSIT_FEE, voucher, usdst);
    const bD = computeMaxTransferable(tokenBMaxAmount, addrB, DEPOSIT_FEE, voucher, usdst);
    
    return { aS, bS, aD, bD };
  }, [isOpen, selectedPool?.address, selectedPool?.tokenA?.address, selectedPool?.tokenB?.address, tokenAMaxAmount, tokenBMaxAmount, voucher, usdst]);

  // Check if dual deposits are feasible
  const dualFeasible = useMemo(() => {
    if (!poolView) return false;
    if (isBootstrap) return maxes.aD > 0n && maxes.bD > 0n;
    return maxes.aD >= AMin && maxes.bD > 0n;
  }, [poolView, isBootstrap, maxes.aD, maxes.bD, AMin]);


  // Set initial deposit mode based on available balances
  const [depositMode, setDepositMode] = useState<"A" | "B" | "A&B">(() => {
    const canA = maxes.aD > 0n;
    const canB = maxes.bD > 0n;
    const canAmin = maxes.aS > 0n;
    const canBmin = maxes.bS > 0n;
    
    if (dualFeasible) {
      return "A&B";
    } else if (canA && canAmin) {
      return "A";
    } else if (canB && canBmin) {
      return "B";
    } else {
      return "A";
    }
  });

  // Derived from deposit mode
  const isDual = depositMode === "A&B";

  // Fee gating
  const canPayFeeSingle = (usdst + voucher) >= feeWeiSingle;
  const canPayFeeDual = (usdst + voucher) >= feeWeiDual;
  const canPayFee = isDual ? canPayFeeDual : canPayFeeSingle;
  const feeError = canPayFee ? null : `Insufficient USDST + vouchers for transaction fee. You have ${formatUnits(usdst + voucher, DECIMALS)} USDST, need ${isDual ? DEPOSIT_FEE : SINGLE_TOKEN_DEPOSIT_FEE} USDST`;
  const validationFee = isDual ? DEPOSIT_FEE : SINGLE_TOKEN_DEPOSIT_FEE;
  const vouchersRequired = isDual ? vouchersRequiredDual : vouchersRequiredSingle;

  // Token balance error (only show if user can pay fees but has no tokens)
  const tokenBalanceError = (maxes.aS <= 0n && maxes.bS <= 0n && canPayFee) ? "You only have enough USDST to cover transaction fees, but no tokens to deposit" : null;

  // Dual mode max amounts (canonicalized to pool ratio)
  const dualMax = useMemo(() => {
    if (!poolView || !isDual || isBootstrap) return { A: maxes.aD, B: maxes.bD };
    
    return {
      A: canon("A", maxes.aD, poolView.RA, poolView.RB, maxes.aD, maxes.bD).A,
      B: canon("B", maxes.bD, poolView.RA, poolView.RB, maxes.aD, maxes.bD).B,
    };
  }, [isDual, isBootstrap, poolView?.RA, poolView?.RB, maxes.aD, maxes.bD]);

  const maxA = isDual ? maxes.aD : maxes.aS;
  const maxB = isDual ? maxes.bD : maxes.bS;

  // ============================================================================
  // EFFECTS
  // ============================================================================


  // Reset on pool change
  useEffect(() => {
    setAstr("");
    setBstr("");
    setPrimary("A");
  }, [selectedPool?.address]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const canonicalizeFromPrimary = useCallback((newPrimary?: "A" | "B") => {
    if (!poolView || isBootstrap || (Awei === 0n && Bwei === 0n)) return;
    
    const currentPrimary = newPrimary ?? primary;
    
    if (currentPrimary === "A") {
      const { A, B } = canon("A", Awei, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setAstr(formatUnits(A, decA));
      setBstr(formatUnits(B, decB));
    } else {
      const { A, B } = canon("B", Bwei, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setAstr(formatUnits(A, decA));
      setBstr(formatUnits(B, decB));
    }
  }, [poolView, isBootstrap, Awei, Bwei, primary, maxes.aD, maxes.bD, decA, decB]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleTokenChange = useCallback((side: "A" | "B", value: string) => {
    if (!poolView) return;

    const isA = side === "A";
    const decimals = isA ? decA : decB;

    // always update the edited field verbatim
    if (isA) setAstr(value); else setBstr(value);

    // Clear any existing error for this field
    if (isA) setToken1AmountError(""); else setToken2AmountError("");

    // if user cleared input, don't touch the other side
    if (value.trim() === "") return;

    const inputBigInt = safeParseUnits(value, decimals);

    // no canon in bootstrap or single-token modes
    if (isBootstrap || depositMode !== "A&B") return;

    // clamp to spendable caps to avoid impossible quotes
    const cap = isA ? maxes.aD : maxes.bD;
    const X = inputBigInt > cap ? cap : inputBigInt;

    if (isA) {
      const { B } = canon("A", X, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setBstr(formatUnits(B, decB));
    } else {
      const { A } = canon("B", X, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setAstr(formatUnits(A, decA));
    }
  }, [poolView, decA, decB, depositMode, isBootstrap, maxes.aD, maxes.bD]);

  // Prebind the two handlers once for stability
  const onAChange = useCallback((value: string) => handleTokenChange("A", value), [handleTokenChange]);
  const onBChange = useCallback((value: string) => handleTokenChange("B", value), [handleTokenChange]);

  const handleMaxClick = useCallback((side: "A" | "B") => () => {
    if (!poolView) return;
    
    if (depositMode === side) {
      // Single mode - set to max
      if (side === "A") {
        setAstr(formatUnits(maxes.aS, decA));
      } else {
        setBstr(formatUnits(maxes.bS, decB));
      }
      return;
    }

    // Bootstrap mode - set to spendable cap
    if (isBootstrap) {
      if (side === "A") {
        setAstr(formatUnits(maxes.aD, decA));
      } else {
        setBstr(formatUnits(maxes.bD, decB));
      }
      return;
    }

    // Dual mode with existing liquidity - use canonical functions with spendable caps
    if (side === "A") {
      const { A, B } = canon("A", maxes.aD, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setAstr(formatUnits(A, decA));
      setBstr(formatUnits(B, decB));
    } else {
      const { A, B } = canon("B", maxes.bD, poolView.RA, poolView.RB, maxes.aD, maxes.bD);
      setAstr(formatUnits(A, decA));
      setBstr(formatUnits(B, decB));
    }
  }, [poolView, depositMode, isBootstrap, maxes.aS, maxes.bS, maxes.aD, maxes.bD, decA, decB]);

  const handlePrimaryToggle = useCallback(() => {
    if (!poolView || !isDual) return;
    const newPrimary = primary === "A" ? "B" : "A";
    setPrimary(newPrimary);
    setToken1AmountError(""); // Clear Token A error
    setToken2AmountError(""); // Clear Token B error
    canonicalizeFromPrimary(newPrimary);
  }, [poolView, isDual, primary, canonicalizeFromPrimary]);

  const handleDepositModeChange = useCallback((mode: "A" | "B" | "A&B") => {
    setDepositMode(mode);
    if (mode === "A") {
      setBstr("");
      setToken2AmountError(""); // Clear Token B error when switching to A-only
    } else if (mode === "B") {
      setAstr("");
      setToken1AmountError(""); // Clear Token A error when switching to B-only
    } else if (mode === "A&B") {
      canonicalizeFromPrimary();
    }
  }, [canonicalizeFromPrimary]);

  const handleClose = useCallback(() => {
    setAstr("");
    setBstr("");
    setToken1AmountError("");
    setToken2AmountError("");
    onClose();
  }, [onClose]);

  const handleDepositSubmit = async () => {
    if (
      !poolView ||
      operationInProgressRef.current ||
      depositLoading ||
      !canPayFee
    )
      return;

    operationInProgressRef.current = true;
    setDepositLoading(true);

    try {
      if (depositMode === "A" || depositMode === "B") {
        await addLiquiditySingleToken({
          poolAddress: selectedPool!.address,
          singleTokenAmount: (depositMode === "A" ? Awei : Bwei).toString(),
          isAToB: depositMode === "A",
        });
      } else {
        // Dual mode: validate and clamp to ensure contract acceptance
        if (!isBootstrap) {
          // Re-read fresh reserves at submit time to handle drift
          const freshRA = BigInt(selectedPool.tokenABalance ?? "0");
          const freshRB = BigInt(selectedPool.tokenBBalance ?? "0");
          
          // Safety check for zero reserves (very rare desync case)
          if (freshRA === 0n || freshRB === 0n) {
            toast({
              title: "Pool data error",
              description: "Pool reserves are temporarily unavailable. Please try again.",
              variant: "destructive",
            });
            return;
          }
          
          // Re-quote with fresh reserves
          const bMax = Awei > 0n ? floorDiv((Awei - 1n) * freshRB, freshRA) : 0n;
          const Bclamped = Bwei > bMax ? bMax : Bwei;
          const Areq = floorDiv(Bclamped * freshRA, freshRB) + 1n;
          
          // Check if Bclamped == 0 (A too small for any B to fit)
          if (Bclamped === 0n) {
            toast({
              title: "Invalid amounts",
              description: `Token A amount too small for dual deposit. Minimum required: ${formatUnits(AMin, decA)} ${poolView.nameA}`,
              variant: "destructive",
            });
            return;
          }
          
          if (Awei < Areq) {
            toast({
              title: "Invalid amounts",
              description: `Token A amount too small for dual deposit. Required: ${formatUnits(Areq, decA)}`,
              variant: "destructive",
            });
            return;
          }
          
          // Guard: If Areq > maxes.aD, block with clear message
          if (Areq > maxes.aD) {
            toast({
              title: "Insufficient balance",
              description: `Required Token A amount (${formatUnits(Areq, decA)}) exceeds your balance (${formatUnits(maxes.aD, decA)})`,
              variant: "destructive",
            });
            return;
          }
          
          await addLiquidityDualToken({
            poolAddress: selectedPool!.address,
            maxTokenAAmount: Areq.toString(),
            tokenBAmount: Bclamped.toString(),
          });
        } else {
          // Bootstrap mode: no ratio constraints
          await addLiquidityDualToken({
            poolAddress: selectedPool!.address,
            maxTokenAAmount: Awei.toString(),
            tokenBAmount: Bwei.toString(),
          });
        }
      }

      toast({
        title: "Success",
        description: `Liquidity added to ${poolView.nameA}/${poolView.nameB}`,
        variant: "success",
      });

      handleClose();
    } finally {
      // Always call success callback and reset loading state, even if transaction fails
      await onDepositSuccess();
      setDepositLoading(false);
      operationInProgressRef.current = false;
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const isConfirmButtonDisabled =
    depositLoading ||
    !!token1AmountError ||
    !!token2AmountError ||
    (!isDual ? !canPayFeeSingle : !canPayFeeDual) ||
    (depositMode === "A" && Awei === 0n) ||
    (depositMode === "B" && Bwei === 0n) ||
    (isDual && (Awei === 0n || Bwei === 0n)) ||
    (isDual && !dualFeasible);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Liquidity</DialogTitle>
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
              onClick={() => handleDepositModeChange("A")}
              disabled={maxes.aS <= 0n}
              className="flex-1 text-xs"
            >
              {selectedPool?.tokenA?.symbol || poolView?.nameA} Only
            </Button>

            <Button
              type="button"
              variant={depositMode === "B" ? "default" : "outline"}
              size="sm"
              onClick={() => handleDepositModeChange("B")}
              disabled={maxes.bS <= 0n}
              className="flex-1 text-xs"
            >
              {selectedPool?.tokenB?.symbol || poolView?.nameB} Only
            </Button>

            <Button
              type="button"
              variant={depositMode === "A&B" ? "default" : "outline"}
              size="sm"
              onClick={() => handleDepositModeChange("A&B")}
              disabled={!dualFeasible || !canPayFeeDual}
              className="flex-1 text-xs"
            >
              Both Tokens
            </Button>
          </div>
          
          {/* Helper text when Both Tokens button is disabled */}
          {!dualFeasible && maxes.aD > 0n && maxes.bD > 0n && !isBootstrap && (
            <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded mt-2">
              ≈Minimum A for dual deposit: {formatUnits(AMin, decA)} {poolView?.nameA}
            </div>
          )}

          {/* Token Inputs */}
          <div className="grid grid-cols-1 gap-4 px-1">
            <TokenInput
              value={Astr}
              error={token1AmountError}
              tokenName={`${poolView?.nameA} Amount`}
              tokenSymbol={selectedPool?.tokenA?.symbol || poolView?.nameA}
              tokenAddress={selectedPool?.tokenA?.address || ""}
              maxAmount={isDual ? dualMax.A : maxA}
              maxTransferable={isDual ? dualMax.A : maxA}
              transactionFee={isDual ? "0" : validationFee}
              decimals={decA}
              disabled={maxA <= 0n || depositMode === "B" || (isDual && primary === "B" && !isBootstrap)}
              loading={depositLoading}
              usdstBalance={usdst}
              voucherBalance={voucher}
              onValueChange={onAChange}
              onErrorChange={setToken1AmountError}
              onMaxClick={handleMaxClick("A")}
              rightButton={
                isDual && !isBootstrap ? (
                  <Button
                    type="button"
                    variant={primary === "A" ? "default" : "outline"}
                    size="sm"
                    onClick={handlePrimaryToggle}
                    className="h-6 px-2 text-xs"
                  >
                    {primary === "A" ? "Primary" : "Set"}
                  </Button>
                ) : (
                  <div className="h-6 w-16" /> // Reserve space to prevent layout shift
                )
              }
            />
            
            {/* Helper text for dual mode minimum A */}
            {isDual && !isBootstrap && !dualFeasible && maxes.aD > 0n && (
              <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                ≈Minimum A for dual deposit: {formatUnits(AMin, decA)} {poolView?.nameA}
              </div>
            )}

            <TokenInput
              value={Bstr}
              error={token2AmountError}
              tokenName={`${poolView?.nameB} Amount`}
              tokenSymbol={selectedPool?.tokenB?.symbol || poolView?.nameB}
              tokenAddress={selectedPool?.tokenB?.address || ""}
              maxAmount={isDual ? dualMax.B : maxB}
              maxTransferable={isDual ? dualMax.B : maxB}
              transactionFee={isDual ? "0" : validationFee}
              decimals={decB}
              disabled={maxB <= 0n || depositMode === "A" || (isDual && primary === "A" && !isBootstrap)}
              loading={depositLoading}
              usdstBalance={usdst}
              voucherBalance={voucher}
              onValueChange={onBChange}
              onErrorChange={setToken2AmountError}
              onMaxClick={handleMaxClick("B")}
              rightButton={
                isDual && !isBootstrap ? (
                  <Button
                    type="button"
                    variant={primary === "B" ? "default" : "outline"}
                    size="sm"
                    onClick={handlePrimaryToggle}
                    className="h-6 px-2 text-xs"
                  >
                    {primary === "B" ? "Primary" : "Set"}
                  </Button>
                ) : (
                  <div className="h-6 w-16" /> // Reserve space to prevent layout shift
                )
              }
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
                <span className="text-sm text-gray-500">Current pool ratio</span>
                <span className="font-medium text-sm text-right">
                  {selectedPool && poolView &&
                    `1 ${poolView.nameA} = ${Number(selectedPool.aToBRatio || 0).toFixed(6)} ${poolView.nameB}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Transaction fee</span>
                <span className="font-medium text-sm">
                  {validationFee} USDST ({vouchersRequired} vouchers)
                </span>
              </div>
            </div>
            {feeError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{feeError}</p>
              </div>
            )}
            {tokenBalanceError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-600">{tokenBalanceError}</p>
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
              {depositLoading ? "Adding Liquidity..." : "Confirm Deposit"}
            </Button>
          </div>
        </form>
        </DialogContent>
      </Dialog>
  );
};

export default LiquidityDepositModal;
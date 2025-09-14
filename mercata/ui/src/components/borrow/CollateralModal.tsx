import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CollateralData, NewLoanData } from "@/interface";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { 
  calculateSupplyHealthImpact, 
  calculateWithdrawHealthImpact,
  getMaxSafeWithdrawAmount 
} from "@/utils/lendingUtils";
import { computeMaxTransferable } from "@/utils/validationUtils";
import RiskLevelProgress from "@/components/ui/RiskLevelProgress";
import HealthImpactDisplay from "@/components/ui/HealthImpactDisplay";
import TokenInput from "@/components/shared/TokenInput";
import { useUserTokens } from "@/context/UserTokensContext";
import { VOUCHERS_PER_UNIT } from "@/lib/constants";

type ModalType = "supply" | "withdraw";

interface CollateralModalProps {
  type: ModalType;
  loading: boolean;
  asset: CollateralData;
  loanData: NewLoanData;
  isOpen: boolean;
  onClose: () => void;
  onAction: (amount: string) => void;
  transactionFee: string;
}

const CollateralModal = ({
  type,
  loading,
  asset,
  loanData,
  isOpen,
  onClose,
  onAction,
  transactionFee,
}: CollateralModalProps) => {
  // State
  const [amount, setAmount] = useState<string>("");
  const [inputError, setInputError] = useState<string>("");

  // Context
  const { usdstBalance: usdstBalanceStr, voucherBalance: voucherBalanceStr } = useUserTokens();
  const usdst = BigInt(usdstBalanceStr || "0");
  const voucher = BigInt(voucherBalanceStr || "0");

  // Constants
  const isSupply = type === "supply";
  const tokenDecimals = asset?.customDecimals ?? 18;
  const hasDebt = BigInt(loanData?.totalAmountOwed || "0") > 0n;
  
  // Calculations
  const maxAmount = isSupply 
    ? BigInt(asset?.userBalance || 0)
    : getMaxSafeWithdrawAmount(asset, loanData);
  const maxDisplayAmount = (!isSupply && hasDebt && maxAmount > 0n) ? (maxAmount - 1n) : maxAmount;
  const maxTransferable = computeMaxTransferable(
    maxAmount,
    asset?.address || "",
    transactionFee,
    voucher,
    usdst
  );

  // Derived values
  const amountWei = useMemo(() => {
    try { return safeParseUnits(amount || "0", tokenDecimals); } catch { return 0n; }
  }, [amount, tokenDecimals]);

  const riskLevel = useMemo(() => {
    const owed = BigInt(loanData?.totalAmountOwed || "0");
    const collUSD = BigInt(loanData?.totalCollateralValueUSD || "0");
    if (owed === 0n && collUSD === 0n) return 0;
    const price = BigInt(asset?.assetPrice || "0");
    const lt = BigInt(asset?.liquidationThreshold || 0);
    const deltaUSD = (amountWei * price * lt) / ((10n ** BigInt(tokenDecimals)) * 10000n);
    const newColl = isSupply ? collUSD + deltaUSD : collUSD - deltaUSD;
    if (newColl <= 0n) return 0;
    const pct = Number((owed * 10000n) / newColl) / 100;
    return Math.max(0, Math.min(pct, 100));
  }, [amountWei, isSupply, asset, loanData, tokenDecimals]);

  const healthImpact = useMemo(() => {
    const fn = isSupply ? calculateSupplyHealthImpact : calculateWithdrawHealthImpact;
    return fn(amountWei, asset, loanData);
  }, [amountWei, isSupply, asset, loanData]);

  const feeError = useMemo(() => {
    const fee = safeParseUnits(transactionFee, 18);
    return (usdst + voucher) < fee
      ? `Insufficient USDST + vouchers for transaction fee (${transactionFee} USDST required)`
      : "";
  }, [transactionFee, usdst, voucher]);

  const amountValid = amountWei > 0n && amountWei <= (maxTransferable ?? 0n);
  const disabled = loading || !!feeError || !!inputError || !maxTransferable || !amountValid || (!isSupply && !healthImpact.isHealthy);
  // Event Handlers
  const handleClose = () => {
    setAmount("");
    setInputError("");
    onClose();
  };

  const handleMaxClick = () => {
    if (maxTransferable) {
      const maxValue = formatUnits(maxTransferable, tokenDecimals);
      setAmount(maxValue);
    }
  };

  const handleAction = () => {
    if (!isSupply && maxDisplayAmount > 0n && amountWei >= maxDisplayAmount) onAction("ALL");
    else onAction(amount);
    setAmount("");
    setInputError("");
  };

  // Inline helpers
  const title = `${isSupply ? "Supply" : "Withdraw"} ${asset?._name} as Collateral`;
  const amountLabel = `${isSupply ? "Supply" : "Withdraw"} Amount`;
  const balanceText = isSupply ? "Available to supply" : "Collateral supplied";
  const balanceValue = isSupply
    ? formatUnits(asset?.userBalance || 0, tokenDecimals)
    : formatUnits(asset?.collateralizedAmount || 0, tokenDecimals);


  // Render
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {asset?.images?.[0] ? (
              <img
                src={asset.images[0].value}
                alt={asset._name}
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                style={{ backgroundColor: "red" }}
              >
                {asset?._symbol?.slice(0, 2) || "??"}
              </div>
            )}
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">{balanceText}</span>
              <span className="font-medium">{balanceValue}</span>
            </div>
            {!isSupply && (
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Max withdrawable now</span>
                <span className="font-medium">{formatUnits(maxDisplayAmount, asset?.customDecimals ?? 18)}</span>
              </div>
            )}
          </div>

          <TokenInput
            value={amount}
            error={inputError}
            tokenName={amountLabel}
            tokenSymbol={asset?._symbol || ""}
            maxTransferable={maxTransferable}
            decimals={asset?.customDecimals ?? 18}
            disabled={loading || maxTransferable === 0n}
            loading={loading}
            onValueChange={setAmount}
            onErrorChange={setInputError}
            onMaxClick={handleMaxClick}
            showPercentageButtons={maxTransferable && maxTransferable >= 100n}
          />

          {/* Risk Level */}
          <RiskLevelProgress riskLevel={riskLevel} />

          {/* Health Impact Section */}
          <HealthImpactDisplay healthImpact={healthImpact} showWarning={false} className="pb-0" />

          {/* Transaction Fee Display */}
          <div className="px-4 bg-gray-50 rounded-md">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">
                {transactionFee} USDST ({Math.round(Number(transactionFee) * VOUCHERS_PER_UNIT)} vouchers)
              </span>
            </div>
            {feeError && <p className="text-red-600 text-sm mt-1">{feeError}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={disabled}
            onClick={handleAction}
            className="px-6"
          >
            {loading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            {isSupply ? "Supply" : "Withdraw"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CollateralModal; 
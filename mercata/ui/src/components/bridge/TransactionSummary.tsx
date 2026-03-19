import React from "react";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { BRIDGE_OUT_FEE, DECIMAL, WAD } from "@/lib/constants";
import { BridgeToken } from "@mercata/shared-types";
import { AlertTriangle } from "lucide-react";

const FEE_VOUCHER = parseFloat(BRIDGE_OUT_FEE) * 100;

interface TransactionSummaryProps {
  selectedToken: BridgeToken | null;
  amount: string;
  selectedNetwork: string | null;
  amountError: string;
  balanceImpact: { before: string; after: string };
  formatBalanceDisplay: (valueWei: string) => string;
}

function computeRebasedOutcome(amount: string, rebaseFactor: string): string {
  try {
    const factor = BigInt(rebaseFactor);
    if (factor <= 0n) return amount;
    return formatUnits((safeParseUnits(amount, 18) * factor) / WAD, 18);
  } catch {
    return amount;
  }
}

const TransactionSummary: React.FC<TransactionSummaryProps> = ({
  selectedToken,
  amount,
  selectedNetwork,
  amountError,
  balanceImpact,
  formatBalanceDisplay,
}) => {
  const isRebasing = !!selectedToken?.rebaseFactor;
  const outcomeAmount = isRebasing && amount
    ? computeRebasedOutcome(amount, selectedToken.rebaseFactor!)
    : (amount || "0.00");

  return (
    <div className="rounded-xl border border-border bg-muted/50 p-3 md:p-4 space-y-2 md:space-y-3 text-xs md:text-sm text-muted-foreground">
      <div>
        <span>
          Amount will be rounded down to{" "}
          {selectedToken?.externalDecimals || "18"} decimal places
        </span>
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-0.5 md:gap-2">
        <span>Transaction Fee</span>
        <span className="font-medium text-foreground">
          {BRIDGE_OUT_FEE} USDST ({FEE_VOUCHER} voucher)
        </span>
      </div>
      {selectedToken?.maxPerWithdrawal &&
        BigInt(selectedToken.maxPerWithdrawal) > 0n && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-0.5 md:gap-2">
            <span>Max Per Withdrawal</span>
            <span className="font-medium text-foreground">
              {formatUnits(selectedToken.maxPerWithdrawal, DECIMAL).toString()}
            </span>
          </div>
        )}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-0.5 md:gap-2">
        <span>{selectedToken?.stratoTokenSymbol || ""} Balance</span>
        <span className="font-medium text-foreground">
          {formatBalanceDisplay(balanceImpact.before)}
          {amountError
            ? ""
            : " → " + formatBalanceDisplay(balanceImpact.after)}
        </span>
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-0.5 md:gap-2">
        <span>Outcome</span>
        <span className="font-medium text-foreground">
          {outcomeAmount} {selectedToken?.externalSymbol || ""} to{" "}
          {selectedNetwork || "external network"}
        </span>
      </div>
      {isRebasing && (
        <div className="flex items-start gap-2 pt-1">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">
            Rebasing token — the received quantity may differ slightly due to multiplier changes between now and execution.
          </span>
        </div>
      )}
    </div>
  );
};

export default TransactionSummary;

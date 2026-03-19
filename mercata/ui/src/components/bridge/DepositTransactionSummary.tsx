import React from "react";
import { BridgeToken } from "@mercata/shared-types";

interface DepositTransactionSummaryProps {
  selectedToken: BridgeToken | null;
  amount: string;
  amountError: string;
  balanceImpact: { before: string; after: string };
  formatBalanceDisplay: (valueWei: string) => string;
  savingRate?: number;
  isSaving: boolean;
  autoDeposit?: boolean;
}

const DepositTransactionSummary: React.FC<DepositTransactionSummaryProps> = ({
  selectedToken,
  amount,
  amountError,
  balanceImpact,
  formatBalanceDisplay,
  savingRate,
  isSaving,
  autoDeposit,
}) => {
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4 space-y-3 text-sm text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>{selectedToken?.externalSymbol || ""} Balance</span>
        <span className="font-medium text-foreground">
          {formatBalanceDisplay(balanceImpact.before)}
          {amountError
            ? ""
            : " → " + formatBalanceDisplay(balanceImpact.after)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span>Outcome</span>
        <span className="font-medium text-foreground">
          {amount || "0.00"} {selectedToken?.stratoTokenSymbol || "USDST"} deposited
        </span>
      </div>
      {isSaving && (
        <div className="flex items-center justify-between">
          <span>Current Saving Rate</span>
          <span className={`font-medium ${autoDeposit && savingRate !== undefined ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
            {autoDeposit && savingRate !== undefined ? `${savingRate.toFixed(2)}%` : "—"}
          </span>
        </div>
      )}
    </div>
  );
};

export default DepositTransactionSummary;


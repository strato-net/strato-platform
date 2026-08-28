import React from "react";
import { BridgeToken } from "@strato/shared-types";

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
        <span>{selectedToken?.externalSymbol || ""} balance</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatBalanceDisplay(balanceImpact.before)}
          {amountError
            ? ""
            : " → " + formatBalanceDisplay(balanceImpact.after)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span>Outcome</span>
        <span className="font-medium text-foreground tabular-nums">
          {amount || "0.00"} {selectedToken?.stratoTokenSymbol || "USDST"} deposited
        </span>
      </div>
      {isSaving && (
        <div className="flex items-center justify-between">
          <span>Current saving rate</span>
          <span className={`font-medium tabular-nums ${autoDeposit && savingRate !== undefined ? 'text-success' : 'text-muted-foreground'}`}>
            {autoDeposit && savingRate !== undefined ? `${savingRate.toFixed(2)}%` : "—"}
          </span>
        </div>
      )}
    </div>
  );
};

export default DepositTransactionSummary;


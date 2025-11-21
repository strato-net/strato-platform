import React from "react";
import { BridgeToken } from "@mercata/shared-types";

interface DepositTransactionSummaryProps {
  selectedToken: BridgeToken | null;
  amount: string;
  amountError: string;
  balanceImpact: { before: string; after: string };
  formatBalanceDisplay: (valueWei: string) => string;
  savingRate?: number;
  isConvert: boolean;
}

const DepositTransactionSummary: React.FC<DepositTransactionSummaryProps> = ({
  selectedToken,
  amount,
  amountError,
  balanceImpact,
  formatBalanceDisplay,
  savingRate,
  isConvert,
}) => {
  return (
    <div className="rounded-xl border bg-gray-50 p-4 space-y-3 text-sm text-gray-600">
      <div className="flex items-center justify-between">
        <span>{selectedToken?.externalSymbol || ""} Balance</span>
        <span className="font-medium">
          {formatBalanceDisplay(balanceImpact.before)}
          {amountError
            ? ""
            : " → " + formatBalanceDisplay(balanceImpact.after)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span>Outcome</span>
        <span className="font-medium">
          {amount || "0.00"} {selectedToken?.stratoTokenSymbol || "USDST"} deposited
        </span>
      </div>
      {isConvert && savingRate !== undefined && (
        <div className="flex items-center justify-between">
          <span>Current Saving Rate</span>
          <span className="font-medium text-green-600">
            {savingRate.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  );
};

export default DepositTransactionSummary;


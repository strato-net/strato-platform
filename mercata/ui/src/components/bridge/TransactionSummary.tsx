import React from "react";
import { formatUnits } from "@/utils/numberUtils";
import { BRIDGE_OUT_FEE, DECIMAL } from "@/lib/constants";
import { BridgeToken } from "@mercata/shared-types";

const FEE_VOUCHER = parseFloat(BRIDGE_OUT_FEE) * 100;

interface TransactionSummaryProps {
  selectedToken: BridgeToken | null;
  amount: string;
  selectedNetwork: string | null;
  amountError: string;
  balanceImpact: { before: string; after: string };
  formatBalanceDisplay: (valueWei: string) => string;
}

const TransactionSummary: React.FC<TransactionSummaryProps> = ({
  selectedToken,
  amount,
  selectedNetwork,
  amountError,
  balanceImpact,
  formatBalanceDisplay,
}) => {
  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4 space-y-3 text-sm text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>
          Amount will be rounded down to{" "}
          {selectedToken?.externalDecimals || "18"} decimal places
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span>Transaction Fee</span>
        <span className="font-medium text-foreground">
          {BRIDGE_OUT_FEE} USDST ({FEE_VOUCHER} voucher)
        </span>
      </div>
      {selectedToken?.maxPerWithdrawal &&
        BigInt(selectedToken.maxPerWithdrawal) > 0n && (
          <div className="flex items-center justify-between">
            <span>Max Per Withdrawal</span>
            <span className="font-medium text-foreground">
              {formatUnits(selectedToken.maxPerWithdrawal, DECIMAL).toString()}
            </span>
          </div>
        )}
      <div className="flex items-center justify-between">
        <span>{selectedToken?.stratoTokenSymbol || ""} Balance</span>
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
          {amount || "0.00"} {selectedToken?.externalSymbol || ""} to{" "}
          {selectedNetwork || "external network"}
        </span>
      </div>
    </div>
  );
};

export default TransactionSummary;


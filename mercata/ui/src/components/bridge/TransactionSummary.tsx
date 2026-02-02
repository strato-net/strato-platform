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
          {amount || "0.00"} {selectedToken?.externalSymbol || ""} to{" "}
          {selectedNetwork || "external network"}
        </span>
      </div>
    </div>
  );
};

export default TransactionSummary;


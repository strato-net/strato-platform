import { useTokenContext } from "@/context/TokenContext";
import { describeFallback, describeFee, feeBalanceLow, feeCurrencySpend, feeShortfall } from "@/utils/feeUtils";

/** The network fee for `calls` contract calls, as the signed-in user will pay it. */
const NetworkFee = ({ calls = 1 }: { calls?: number }) => {
  const { feeQuote } = useTokenContext();
  return <>{feeQuote ? describeFee(feeQuote, calls) : "…"}</>;
};

export default NetworkFee;

interface FeeNoticesProps {
  calls?: number;
  /** What the action spends of `tokenAddress`, wei; counts against the fee only when that is the fee currency. */
  spendingWei?: bigint;
  tokenAddress?: string;
}

/** Why the action's fee cannot be paid, how USDST covers a STRATO shortfall, or a warning that fee funds run low after it. */
export const FeeNotices = ({ calls = 1, spendingWei = 0n, tokenAddress }: FeeNoticesProps) => {
  const { feeQuote } = useTokenContext();
  if (!feeQuote) return null;
  const spending = feeCurrencySpend(feeQuote, tokenAddress, spendingWei);
  const shortfall = feeShortfall(feeQuote, calls, spending);
  if (shortfall) return <p className="text-yellow-600 text-sm mt-1">{shortfall}</p>;
  const fallback = describeFallback(feeQuote, calls, spending.currencyWei);
  if (fallback) return <p className="text-muted-foreground text-sm mt-1">{fallback}</p>;
  if (!feeBalanceLow(feeQuote, calls, spending)) return null;
  return (
    <p className="text-yellow-600 text-sm mt-1">
      Warning: Your {feeQuote.currency} balance is running low. Add more funds now to avoid issues with future transactions.
    </p>
  );
};

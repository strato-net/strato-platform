import React, { useEffect, useState, useMemo } from "react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, AlertTriangle, HelpCircle, Minus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { formatBalance, formatWeiAmount, formatCurrency } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Token } from "@/interface";

// Warn at this many transactions or fewer, or when only gas sponsored ones are left; none left is critical
const LOW_CALLS = 10n;
// USDST buying STRATO pays the pool's 0.30% fee on top of the $0.01 a transaction is worth
const POOL_FEE_BPS = 30n;
// Fixed-point scale for fractional transaction counts
const ONE = 10n ** 18n;

interface FeeSourceRow {
  label: string;
  detail: string;
  /** Transactions this balance pays for, scaled by ONE. */
  calls: bigint;
}

/** A scaled transaction count truncated to two decimals: "2,722.97", "5". */
const formatCalls = (scaled: bigint) =>
  (Number(scaled / 10n ** 16n) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

const UsdstBalanceBox: React.FC = () => {
  const { userAddress, isLoggedIn } = useUser();
  const { feeQuote, loadingUsdstBalance, fetchUsdstBalance, getToken } = useTokenContext();
  const currency = feeQuote?.currency ?? "STRATO";
  const location = useLocation();
  const [isMinimized, setIsMinimized] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [feeToken, setFeeToken] = useState<Token | null>(null);

  useEffect(() => {
    if (isLoggedIn) {
      fetchUsdstBalance();
    }
  }, [fetchUsdstBalance, isLoggedIn]);

  // Fetch the fee token's info for its image
  const currencyAddress = feeQuote?.currencyAddress;
  useEffect(() => {
    if (!currencyAddress) return;
    getToken(currencyAddress)
      .then(setFeeToken)
      .catch((error) => console.error(`Error fetching ${currency} token:`, error));
  }, [getToken, currencyAddress, currency]);

  // Transactions each balance pays for: STRATO at the per-transaction quote, USDST at $0.01
  // plus the pool's fee when it buys STRATO, and one per gas sponsored transaction. Without a
  // live STRATO price only the sponsored ones can pay. One transaction can draw on STRATO and
  // USDST together, so the total is the whole part of their exact sum.
  const fees = useMemo(() => {
    if (!feeQuote) return null;
    const feeWei = BigInt(feeQuote.feeWei);
    const priced = feeQuote.valid && feeWei > 0n;
    const stratoQuoted = feeQuote.currency === "STRATO";
    const usdstWei = stratoQuoted ? feeQuote.fallback?.balanceWei ?? "0" : feeQuote.balanceWei;
    const usdstPerTxWei = BigInt(feeQuote.usdFeeWei) * (10_000n + (stratoQuoted ? POOL_FEE_BPS : 0n)) / 10_000n;
    const amount = (wei: string) => formatCurrency(formatWeiAmount(wei));
    const paidRows: FeeSourceRow[] = [
      ...(stratoQuoted
        ? [{
            label: "STRATO",
            detail: `${amount(feeQuote.balanceWei)} STRATO ÷ ${formatBalance(feeQuote.feeWei, "STRATO", 18, undefined, 8)} per transaction`,
            calls: priced ? BigInt(feeQuote.balanceWei) * ONE / feeWei : 0n,
          }]
        : []),
      {
        label: "USDST",
        detail: `${amount(usdstWei)} USDST ÷ ${formatWeiAmount(usdstPerTxWei.toString())} USDST per transaction`,
        calls: priced ? BigInt(usdstWei) * ONE / usdstPerTxWei : 0n,
      },
    ];
    const sponsored = BigInt(feeQuote.vouchers);
    const paid = paidRows.reduce((sum, row) => sum + row.calls, 0n) / ONE;
    const rows = [
      ...paidRows,
      { label: "Gas sponsored transactions", detail: "One transaction each, used first", calls: sponsored * ONE },
    ];
    return { rows, stratoQuoted, priced, paid, total: rows.reduce((sum, row) => sum + row.calls, 0n) / ONE };
  }, [feeQuote]);

  const total = loadingUsdstBalance ? null : fees?.total ?? null;
  const isCriticalBalance = total === 0n;
  const isLowBalance = total !== null && total > 0n && (total <= LOW_CALLS || fees?.paid === 0n);

  // Don't render if user is not logged in or if on homepage
  if (!userAddress || location.pathname === "/") {
    return null;
  }

  const getCardClasses = () => {
    if (isCriticalBalance) return "border-red-300 dark:border-red-700 bg-red-200/95 dark:bg-red-900/95";
    if (isLowBalance) return "border-orange-300 dark:border-orange-700 bg-orange-200/95 dark:bg-orange-900/95";
    return "border-blue-200 dark:border-blue-800 bg-card/95";
  };

  // Render the appropriate icon based on state and token image availability
  const renderIcon = (size: "sm" | "md" | "lg" = "md") => {
    const sizeClasses = {
      sm: "h-4 w-4",
      md: "h-4 w-4",
      lg: "h-5 w-5",
    };

    // If we have a token with image, use it
    if (feeToken?.images?.[0]?.value) {
      return (
        <img
          src={feeToken.images[0].value}
          alt={currency}
          className={`${sizeClasses[size]} rounded-full object-cover`}
        />
      );
    }

    // Fallback to warning/normal icons
    if (isLowBalance || isCriticalBalance) {
      return (
        <AlertTriangle
          className={`${sizeClasses[size]} ${
            isCriticalBalance ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"
          }`}
        />
      );
    }

    return <Coins className={`${sizeClasses[size]} text-blue-600 dark:text-blue-400`} />;
  };

  if (isMinimized) {
    return (
      <Card
        className={`fixed bottom-20 md:bottom-4 right-4 z-50 w-12 h-12 shadow-lg ${getCardClasses()} backdrop-blur-sm`}
      >
        <CardContent className="p-0 h-full flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-full p-0"
            onClick={() => setIsMinimized(false)}
          >
            {renderIcon("lg")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`fixed bottom-20 md:bottom-4 right-4 z-50 w-80 shadow-lg ${getCardClasses()} backdrop-blur-sm`}
    >
      <CardContent className="p-3">
        <div className="flex items-center space-x-2">
          <div
            className={`p-1.5 rounded-full ${
              isCriticalBalance
                ? "bg-red-100 dark:bg-red-900/50"
                : isLowBalance
                ? "bg-orange-100 dark:bg-orange-900/50"
                : "bg-blue-100 dark:bg-blue-900/50"
            }`}
          >
            {renderIcon("lg")}
          </div>
          <div className="flex-1 min-w-0">
            {loadingUsdstBalance ? (
              <p className="text-sm font-semibold text-foreground animate-pulse">Loading...</p>
            ) : fees ? (
              <div className="text-sm font-semibold text-foreground">
                {fees.total.toLocaleString()} {fees.total === 1n ? "Transaction" : "Transactions"} remaining
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How transactions remaining is calculated"
                      className="ml-1 inline-flex align-middle rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => setShowBreakdown(true)}
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Click for more information</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Transactions remaining unavailable</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-secondary"
            onClick={() => setIsMinimized(true)}
          >
            <Minus className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>

        {(isLowBalance || isCriticalBalance) && (
          <div className="mt-2 pt-2 border-t border-border">
            <div
              className={`flex items-start space-x-1 ${
                isCriticalBalance ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"
              }`}
            >
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-medium">
                  {isCriticalBalance
                    ? `Critical: Low gas funds - add ${currency} to continue transacting`
                    : `Warning: Low gas funds - add ${currency} to continue transacting`}
                </p>
                <Link
                  to="/dashboard/deposits/?tab=convert"
                  className="underline hover:no-underline font-medium"
                >
                  Add funds →
                </Link>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {fees && (
        <Dialog open={showBreakdown} onOpenChange={setShowBreakdown}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Transactions remaining</DialogTitle>
              <DialogDescription>
                {fees.stratoQuoted
                  ? "Every transaction pays a network fee worth $0.01. Gas sponsored transactions pay first, then STRATO at its current price, then USDST buys the STRATO needed, plus the pool's 0.3% fee. The total is an estimate, since the STRATO price moves with the market, rounded down to a whole number."
                  : "Every transaction pays a network fee of 0.01 USDST. Gas sponsored transactions pay first, then USDST. The total is an estimate, rounded down to a whole number."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {fees.rows.map((row, i) => (
                <div key={row.label} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.detail}</p>
                  </div>
                  <p className="tabular-nums whitespace-nowrap text-foreground">
                    {i > 0 ? "+ " : ""}
                    {formatCalls(row.calls)}
                  </p>
                </div>
              ))}
              <div className="flex items-center justify-between gap-4 border-t border-border pt-3 font-semibold text-foreground">
                <p>Total</p>
                <p className="tabular-nums whitespace-nowrap">= {fees.total.toLocaleString()}</p>
              </div>
              {!fees.priced && (
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  The STRATO price is unavailable right now, so only gas sponsored transactions can pay until it returns.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
};

export default UsdstBalanceBox;

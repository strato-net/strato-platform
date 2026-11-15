import React, { useEffect, useState, useMemo } from "react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, AlertTriangle, HelpCircle, Minus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { formatWeiAmount, formatCurrency } from "@/utils/numberUtils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";

// Warn when vouchers plus the fee currency cover fewer calls than this
const LOW_CALLS = 1000;
const CRITICAL_CALLS = 3;

// Optimized InfoTooltip component using hook
const InfoTooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const { isMobile, showTooltip, handleToggle } = useMobileTooltip('usdst-balance-tooltip-container');

  if (isMobile) {
    return (
      <div className="relative usdst-balance-tooltip-container">
        <div 
          className="cursor-help"
          onClick={handleToggle}
        >
          {children}
        </div>
        {showTooltip && (
          <div className="absolute bottom-full left-0 mb-2 z-50 bg-popover border rounded-md px-3 py-1.5 text-sm text-popover-foreground shadow-md max-w-xs">
            <p>{content}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
};

const UsdstBalanceBox: React.FC = () => {
  const { userAddress, isLoggedIn } = useUser();
  const { feeQuote, loadingUsdstBalance, fetchUsdstBalance, getToken } = useTokenContext();
  const currency = feeQuote?.currency ?? "STRATO";
  const location = useLocation();
  const [isMinimized, setIsMinimized] = useState(false);
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

  // Calls the user can still pay for: vouchers first, then the fee currency, then USDST buying STRATO.
  const affordableCalls = useMemo(() => {
    if (loadingUsdstBalance || !feeQuote) return 0;
    const feeWei = BigInt(feeQuote.feeWei);
    if (!feeQuote.valid || feeWei === 0n) return Number(feeQuote.vouchers);
    const { fallback } = feeQuote;
    const fromFallback = fallback ? BigInt(fallback.balanceWei) / BigInt(fallback.maxWei) : 0n;
    return Number(BigInt(feeQuote.vouchers) + BigInt(feeQuote.balanceWei) / feeWei + fromFallback);
  }, [feeQuote, loadingUsdstBalance]);

  const isLowBalance = affordableCalls < LOW_CALLS && affordableCalls > CRITICAL_CALLS;
  const isCriticalBalance = affordableCalls <= CRITICAL_CALLS;

  // Don't render if user is not logged in or if on homepage
  if (!userAddress || location.pathname === "/") {
    return null;
  }

  const getCardClasses = () => {
    if (loadingUsdstBalance) return "border-blue-200 dark:border-blue-800 bg-card/95";
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

    // Don't show warning icons when loading
    if (loadingUsdstBalance) {
      return <Coins className={`${sizeClasses[size]} text-blue-600 dark:text-blue-400`} />;
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
      className={`fixed bottom-20 md:bottom-4 right-4 z-50 w-60 shadow-lg ${getCardClasses()} backdrop-blur-sm`}
    >
      <CardContent className="p-3">
        <div className="flex items-center space-x-2">
          <div
            className={`p-1.5 rounded-full ${
              loadingUsdstBalance
                ? "bg-blue-100 dark:bg-blue-900/50"
                : isCriticalBalance
                ? "bg-red-100 dark:bg-red-900/50"
                : isLowBalance
                ? "bg-orange-100 dark:bg-orange-900/50"
                : "bg-blue-100 dark:bg-blue-900/50"
            }`}
          >
            {renderIcon("lg")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground">{currency} Balance</p>
              <InfoTooltip content={`${currency} pays the network fees on STRATO; vouchers cover one call each`}>
                <HelpCircle className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help" />

              </InfoTooltip>
            </div>
            <p className="text-sm font-semibold text-foreground truncate">
              {loadingUsdstBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : (
                `${formatCurrency(formatWeiAmount(feeQuote?.balanceWei || "0"))} ${currency}`
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {loadingUsdstBalance
                ? "Calculating voucher credits…"
                : `${Number(feeQuote?.vouchers || 0).toLocaleString()} vouchers`}
            </p>
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

        {(isLowBalance || isCriticalBalance) && !loadingUsdstBalance && (
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
    </Card>
  );
};

export default UsdstBalanceBox;

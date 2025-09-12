import React, { useEffect, useState } from "react";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, AlertTriangle, HelpCircle, Minus } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import {
  formatWeiAmount,
  formatCurrency,
  safeParseFloat,
} from "@/utils/numberUtils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import { usdstAddress } from "@/lib/constants";
import { useMobileTooltip } from "@/hooks/use-mobile-tooltip";

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
  const { userAddress } = useUser();
  const { usdstBalance, loadingUsdstBalance, fetchUsdstBalance, voucherBalance } =
    useUserTokens();
  const { getToken } = useTokenContext();
  const location = useLocation();
  const [isMinimized, setIsMinimized] = useState(false);
  const [usdstToken, setUsdstToken] = useState<Token | null>(null);

  useEffect(() => {
    if (userAddress) {
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUsdstBalance]);

  // Fetch USDST token info for image
  useEffect(() => {
    const fetchUsdstToken = async () => {
      try {
        const tokenResponse = await getToken(usdstAddress);
        const token = Array.isArray(tokenResponse)
          ? tokenResponse[0]
          : tokenResponse;
        setUsdstToken(token);
      } catch (error) {
        console.error("Error fetching USDST token:", error);
      }
    };

    fetchUsdstToken();
  }, [getToken]);

  const getBalanceValue = (balance: string): number => {
    const formattedBalance = formatWeiAmount(balance);
    return safeParseFloat(formattedBalance);
  };

  const balanceValue = getBalanceValue(usdstBalance);
  const isLowBalance = balanceValue <= 0.2 && balanceValue > 0.03;
  const isCriticalBalance = balanceValue <= 0.03;

  // Don't render if user is not logged in or if on homepage
  if (!userAddress || location.pathname === "/") {
    return null;
  }

  const getCardClasses = () => {
    if (loadingUsdstBalance) return "border-blue-200 bg-white/95";
    if (isCriticalBalance) return "border-red-300 bg-red-200/95";
    if (isLowBalance) return "border-orange-300 bg-orange-200/95";
    return "border-blue-200 bg-white/95";
  };

  // Render the appropriate icon based on state and token image availability
  const renderIcon = (size: "sm" | "md" | "lg" = "md") => {
    const sizeClasses = {
      sm: "h-4 w-4",
      md: "h-4 w-4",
      lg: "h-5 w-5",
    };

    // If we have a token with image, use it
    if (usdstToken?.images?.[0]?.value) {
      return (
        <img
          src={usdstToken.images[0].value}
          alt="USDST"
          className={`${sizeClasses[size]} rounded-full object-cover`}
        />
      );
    }

    // Don't show warning icons when loading
    if (loadingUsdstBalance) {
      return <Coins className={`${sizeClasses[size]} text-blue-600`} />;
    }

    // Fallback to warning/normal icons
    if (isLowBalance || isCriticalBalance) {
      return (
        <AlertTriangle
          className={`${sizeClasses[size]} ${
            isCriticalBalance ? "text-red-600" : "text-orange-600"
          }`}
        />
      );
    }

    return <Coins className={`${sizeClasses[size]} text-blue-600`} />;
  };

  if (isMinimized) {
    return (
      <Card
        className={`fixed bottom-4 right-4 z-50 w-12 h-12 shadow-lg ${getCardClasses()} backdrop-blur-sm`}
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
      className={`fixed bottom-4 right-4 z-50 w-60 shadow-lg ${getCardClasses()} backdrop-blur-sm`}
    >
      <CardContent className="p-3">
        <div className="flex items-center space-x-2">
          <div
            className={`p-1.5 rounded-full ${
              loadingUsdstBalance
                ? "bg-blue-100"
                : isCriticalBalance
                ? "bg-red-100"
                : isLowBalance
                ? "bg-orange-100"
                : "bg-blue-100"
            }`}
          >
            {renderIcon("lg")}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-gray-600">Balances</p>
              <InfoTooltip content="USDST is used to pay for gas fees on the STRATO Mercata network. Vouchers can also be used for gas fees.">
                <HelpCircle className="h-3 w-3 text-gray-400 hover:text-gray-600 cursor-help" />
              </InfoTooltip>
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {loadingUsdstBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : (
                `${formatCurrency(formatWeiAmount(usdstBalance))} USDST`
              )}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {loadingUsdstBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : (
                `${formatCurrency(formatWeiAmount(voucherBalance, 16))} Vouchers`
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-gray-100"
            onClick={() => setIsMinimized(true)}
          >
            <Minus className="h-3 w-3 text-gray-500" />
          </Button>
        </div>

        {(isLowBalance || isCriticalBalance) && !loadingUsdstBalance && (
          <div className="mt-2 pt-2 border-t border-gray-200">
            <div
              className={`flex items-start space-x-1 ${
                isCriticalBalance ? "text-red-600" : "text-orange-600"
              }`}
            >
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-medium">
                  {isCriticalBalance
                    ? "Critical: Low gas funds - add USDST to continue transacting"
                    : "Warning: Low gas funds - add USDST to continue transacting"}
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

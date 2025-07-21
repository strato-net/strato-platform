import React, { useEffect, useState } from 'react';
import { useUserTokens } from '@/context/UserTokensContext';
import { useUser } from '@/context/UserContext';
import { Card, CardContent } from './card';
import { Coins, AlertTriangle, HelpCircle, Minus, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatWeiAmount, formatCurrency } from '@/utils/numberUtils';
import { formatUnits } from 'viem';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { Button } from './button';

const UsdstBalanceBox: React.FC = () => {
  const { userAddress } = useUser();
  const { usdstBalance, loadingUsdstBalance, fetchUsdstBalance } = useUserTokens();
  const [isMinimized, setIsMinimized] = useState(false);

  console.log('USDST Balance:', usdstBalance, 'Loading:', loadingUsdstBalance);

  useEffect(() => {
    if (userAddress) {
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUsdstBalance]);

  // Refresh balance periodically and when window gains focus
  useEffect(() => {
    if (!userAddress) return;

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchUsdstBalance(userAddress);
    }, 30000);

    // Refresh when window gains focus (often after transactions)
    const handleFocus = () => {
      fetchUsdstBalance(userAddress);
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [userAddress, fetchUsdstBalance]);

  const getBalanceValue = (balance: string): number => {
    try {
      return parseFloat(formatUnits(BigInt(balance), 18));
    } catch {
      return 0;
    }
  };

  const balanceValue = getBalanceValue(usdstBalance);
  const isLowBalance = balanceValue <= 0.2 && balanceValue > 0.03;
  const isCriticalBalance = balanceValue <= 0.03;

  // Don't render if user is not logged in
  if (!userAddress) {
    return null;
  }

  const getCardClasses = () => {
    if (isCriticalBalance) return 'border-red-300 bg-red-200/95';
    if (isLowBalance) return 'border-orange-300 bg-orange-200/95';
    return 'border-blue-200 bg-white/95';
  };

  if (isMinimized) {
    return (
      <Card className={`fixed bottom-4 right-4 z-50 w-12 h-12 shadow-lg ${getCardClasses()} backdrop-blur-sm`}>
        <CardContent className="p-0 h-full flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-full w-full p-0"
            onClick={() => setIsMinimized(false)}
          >
            {(isLowBalance || isCriticalBalance) ? (
              <AlertTriangle className={`h-5 w-5 ${isCriticalBalance ? 'text-red-600' : 'text-orange-600'}`} />
            ) : (
              <Coins className="h-5 w-5 text-blue-600" />
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`fixed bottom-4 right-4 z-50 w-60 shadow-lg ${getCardClasses()} backdrop-blur-sm`}>
      <CardContent className="p-3">
        <div className="flex items-center space-x-2">
          <div className={`p-1.5 rounded-full ${isCriticalBalance ? 'bg-red-100' : isLowBalance ? 'bg-orange-100' : 'bg-blue-100'}`}>
            {(isLowBalance || isCriticalBalance) ? (
              <AlertTriangle className={`h-4 w-4 ${isCriticalBalance ? 'text-red-600' : 'text-orange-600'}`} />
            ) : (
              <Coins className="h-4 w-4 text-blue-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-gray-600">USDST Balance</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3 w-3 text-gray-400 hover:text-gray-600 cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>USDST is used to pay for gas fees on the STRATO Mercata network</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {loadingUsdstBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : (
                `${formatCurrency(formatWeiAmount(usdstBalance))} USDST`
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
            <div className={`flex items-start space-x-1 ${isCriticalBalance ? 'text-red-600' : 'text-orange-600'}`}>
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div className="text-xs">
                <p className="font-medium">
                  {isCriticalBalance ? 'Critical: Purchase more USDST' : 'Warning: Running low on USDST'}
                </p>
                <Link 
                  to="/dashboard/deposits" 
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
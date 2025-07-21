import React from 'react';
import { useUserTokens } from '@/context/UserTokensContext';
import { Card, CardContent } from './card';
import { Coins, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatWeiAmount, formatCurrency } from '@/utils/numberUtils';
import { formatUnits } from 'viem';

const UsdstBalanceBox: React.FC = () => {
  const { usdstBalance, loadingUsdstBalance } = useUserTokens();

  console.log('USDST Balance:', usdstBalance, 'Loading:', loadingUsdstBalance);

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

  const getCardBorderClass = () => {
    if (isCriticalBalance) return 'border-red-300';
    if (isLowBalance) return 'border-orange-300';
    return 'border-blue-200';
  };

  return (
    <Card className={`fixed bottom-4 right-4 z-50 w-60 shadow-lg ${getCardBorderClass()} bg-white/95 backdrop-blur-sm`}>
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
            <p className="text-xs font-medium text-gray-600">USDST Balance</p>
            <p className="text-sm font-semibold text-gray-900 truncate">
              {loadingUsdstBalance ? (
                <span className="animate-pulse">Loading...</span>
              ) : (
                `${formatCurrency(formatWeiAmount(usdstBalance))} USDST`
              )}
            </p>
          </div>
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
import { useState, useEffect, useRef } from 'react';
import { formatUnits } from 'viem';
import { Token, EarningAsset } from '@mercata/shared-types';
import { useUser } from '@/context/UserContext';

interface UseNetBalanceProps {
  tokens: EarningAsset[];
  cataToken?: Token | null;
  loans: any;
  totalCDPDebt: string | undefined;
}

interface NetBalanceResult {
  netBalance: number;
  cataBalance: number;
  totalBorrowed: number;
  isLoading: boolean;
}

export const useNetBalance = ({
  tokens,
  cataToken,
  loans,
  totalCDPDebt,
}: UseNetBalanceProps): NetBalanceResult => {
  const { userAddress } = useUser();
  const isLoggedIn = !!userAddress;

  const [result, setResult] = useState<NetBalanceResult>({
    netBalance: 0,
    cataBalance: 0,
    totalBorrowed: 0,
    isLoading: true
  });

  const hasSeenTokensWithData = useRef(false);
  const calculationAttempted = useRef(false);

  useEffect(() => {
    // If user is not logged in, immediately return 0 values without loading
    if (!isLoggedIn) {
      setResult({
        netBalance: 0,
        cataBalance: 0,
        totalBorrowed: 0,
        isLoading: false
      });
      return;
    }

    const isTokensLoaded = Array.isArray(tokens);
    const isLoansLoaded = loans !== undefined;
    const isTotalCDPDebtLoaded = totalCDPDebt !== undefined;

    // Track if we've seen tokens with data
    if (tokens?.length > 0) {
      hasSeenTokensWithData.current = true;
    }

    const hasLendingPoolDebt = loans?.totalAmountOwed && BigInt(loans.totalAmountOwed) > 1n;
    const hasCDPDebt = totalCDPDebt && BigInt(totalCDPDebt) > 1n;
    const hasAnyDebt = hasLendingPoolDebt || hasCDPDebt;

    const tokensIsEmpty = !tokens || tokens.length === 0;
    const shouldWaitForTokens = tokensIsEmpty && hasAnyDebt && !hasSeenTokensWithData.current && !calculationAttempted.current;

    const allDataLoaded = isTokensLoaded && isLoansLoaded && isTotalCDPDebtLoaded;

    if (!allDataLoaded || shouldWaitForTokens) {
      setResult({
        netBalance: 0,
        cataBalance: 0,
        totalBorrowed: 0,
        isLoading: true
      });
      return;
    }

    calculationAttempted.current = true;

    let total = 0;
    let cataTotal = 0;

    // Sum token values from earning assets (value is already calculated on backend)
    for (let i = 0; i < tokens.length; i++) {
      const tokenValue = parseFloat(tokens[i]?.value || "0");
      total += tokenValue;
    }

    // Calculate CATA token balance (not added to total)
    if (cataToken) {
      const rawBalance = cataToken?.balance || "0";

      if (rawBalance) {
        cataTotal = parseFloat(formatUnits(BigInt(rawBalance), 18));
      }
    }

    // Calculate total debt
    const lendingPoolDebt = loans?.totalAmountOwed 
      ? parseFloat(formatUnits((() => { 
          try { 
            const bi = BigInt(loans.totalAmountOwed); 
            return bi <= 1n ? 0n : bi; 
          } catch { 
            return 0n; 
          } 
        })(), 18))
      : 0;

    const cdpDebt = totalCDPDebt
      ? parseFloat(formatUnits((() => {
          try {
            const bi = BigInt(totalCDPDebt);
            return bi <= 1n ? 0n : bi;
          } catch {
            return 0n;
          }
        })(), 18))
      : 0;

    const totalDebt = lendingPoolDebt + cdpDebt;
    const netBalance = total - totalDebt;
    
    setResult({
      netBalance,
      cataBalance: cataTotal,
      totalBorrowed: totalDebt,
      isLoading: false
    });

  }, [tokens, cataToken, loans, totalCDPDebt, isLoggedIn]);

  return result;
};

import { useState, useEffect, useRef } from 'react';
import { formatUnits } from 'viem';
import { Token } from '@/interface';

interface UseNetBalanceProps {
  tokens: Token[];
  cataToken?: Token | null;
  loans: any;
  liquidityInfo: any;
  totalCDPDebt: string;
  safetyInfo?: any;
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
  liquidityInfo,
  totalCDPDebt,
  safetyInfo
}: UseNetBalanceProps): NetBalanceResult => {
  const [result, setResult] = useState<NetBalanceResult>({
    netBalance: 0,
    cataBalance: 0,
    totalBorrowed: 0,
    isLoading: true
  });

  // Track if we've ever seen tokens with data to distinguish between "loading" vs "genuinely empty"
  const hasSeenTokensWithData = useRef(false);
  const calculationAttempted = useRef(false);

  useEffect(() => {
    // Check if all critical data sources are loaded (not undefined)
    // tokens should be an array (even if empty []), loans, liquidityInfo, and totalCDPDebt should be defined
    const isTokensLoaded = Array.isArray(tokens);
    const isLoansLoaded = loans !== undefined;
    const isLiquidityInfoLoaded = liquidityInfo !== undefined;
    const isTotalCDPDebtLoaded = totalCDPDebt !== undefined;
    // Note: safetyInfo is optional, so we don't require it to be loaded

    // Track if we've seen tokens with data (to distinguish "loading" vs "genuinely empty")
    if (tokens?.length > 0) {
      hasSeenTokensWithData.current = true;
    }

    // Check if we have any debt (lending pool or CDP)
    const hasLendingPoolDebt = loans?.totalAmountOwed && BigInt(loans.totalAmountOwed) > 1n;
    const hasCDPDebt = totalCDPDebt && BigInt(totalCDPDebt) > 1n;
    const hasAnyDebt = hasLendingPoolDebt || hasCDPDebt;

    // If tokens array is empty but we have debt, it might be still loading
    // However, if we've already calculated before OR we've seen tokens with data before,
    // then tokens being empty is likely genuine (user has no tokens)
    const tokensIsEmpty = !tokens || tokens.length === 0;
    const shouldWaitForTokens = tokensIsEmpty && hasAnyDebt && !hasSeenTokensWithData.current && !calculationAttempted.current;

    const allDataLoaded = isTokensLoaded && isLoansLoaded && isLiquidityInfoLoaded && isTotalCDPDebtLoaded;

    // If data is still loading OR we should wait for tokens, show loading state
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

    // Calculate token deposit values (includes LP tokens and CDP collateral)

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";

      // Only process tokens with price AND (balance OR collateral)
      if (rawPrice && (rawBalance || rawCollateralBalance)) {
        const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
        const balance = parseFloat(formatUnits(BigInt(rawBalance || 0), 18));
        const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance || 0), 18));

        // Calculate: price * (balance + collateralBalance)
        const totalTokenValue = price * (balance + collateralBalance);
        total += totalTokenValue;
      }
    }

    // Calculate CATA balance from the provided cataToken (if it exists)
    if (cataToken) {
      const rawBalance = cataToken?.balance || "0";
      const rawCollateralBalance = cataToken?.collateralBalance || "0";

      if (rawBalance || rawCollateralBalance) {
        const balance = parseFloat(formatUnits(BigInt(rawBalance || 0), 18));
        const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance || 0), 18));

        // For CATA, track the actual token balance, not USD value
        cataTotal = balance + collateralBalance;
      }
    }

    // Add lending pool value (mUSDST deposits)
    if ((liquidityInfo?.withdrawable as any)?.withdrawValue) {
      const lendingPoolValue = parseFloat(formatUnits(BigInt((liquidityInfo.withdrawable as any).withdrawValue), 18));
      total += lendingPoolValue;
    }

    // Add sUSDST (Safety Module) value  
    if (safetyInfo?.userShares && safetyInfo?.exchangeRate) {
      const userShares = parseFloat(formatUnits(BigInt(safetyInfo.userShares), 18));
      const exchangeRate = parseFloat(formatUnits(BigInt(safetyInfo.exchangeRate), 18));
      
      const sUsdstValue = userShares * exchangeRate;
      total += sUsdstValue;
    }

    // Note: LP tokens are already included in the tokens list above
    // No need to add them separately from userPools to avoid double counting

    // Calculate total debt (BOTH lending pool debt AND CDP vault debt)
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

    // Net balance calculation includes both debt types
    const totalDebt = lendingPoolDebt + cdpDebt;
    const netBalance = total - totalDebt;

    setResult({
      netBalance,
      cataBalance: cataTotal,
      totalBorrowed: totalDebt,
      isLoading: false
    });

  }, [tokens, cataToken, loans, liquidityInfo, totalCDPDebt, safetyInfo]);

  return result;
};

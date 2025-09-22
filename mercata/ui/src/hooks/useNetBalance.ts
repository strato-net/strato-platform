import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { Token } from '@/interface';

interface UseNetBalanceProps {
  tokens: Token[];
  loans: any;
  liquidityInfo: any;
  totalCDPDebt: string;
}

interface NetBalanceResult {
  netBalance: number;
  cataBalance: number;
  totalBorrowed: number;
}

export const useNetBalance = ({
  tokens,
  loans,
  liquidityInfo,
  totalCDPDebt
}: UseNetBalanceProps): NetBalanceResult => {
  const [result, setResult] = useState<NetBalanceResult>({
    netBalance: 0,
    cataBalance: 0,
    totalBorrowed: 0
  });

  useEffect(() => {
    if (!tokens || tokens.length === 0) return;

    let total = 0;
    let cataTotal = 0;

    // Calculate token deposit values (includes LP tokens and CDP collateral)

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const rawPrice = token?.price || "0";
      const rawBalance = token?.balance || "0";
      const rawCollateralBalance = token?.collateralBalance || "0";
      const name = token?._name || "";
      const symbol = token?._symbol || "";

      // Only process tokens with price AND (balance OR collateral)
      if (rawPrice && (rawBalance || rawCollateralBalance)) {
        const price = parseFloat(formatUnits(BigInt(rawPrice), 18));
        const balance = parseFloat(formatUnits(BigInt(rawBalance || 0), 18));
        const collateralBalance = parseFloat(formatUnits(BigInt(rawCollateralBalance || 0), 18));
        
        // Calculate: price * (balance + collateralBalance)
        const totalTokenValue = price * (balance + collateralBalance);
        total += totalTokenValue;

        if (name.toLowerCase().includes("cata") || symbol.toLowerCase().includes("cata")) {
          cataTotal += totalTokenValue;
        }
      }
    }

    // Add lending pool value (mUSDST deposits)
    if ((liquidityInfo?.withdrawable as any)?.withdrawValue) {
      const lendingPoolValue = parseFloat(formatUnits(BigInt((liquidityInfo.withdrawable as any).withdrawValue), 18));
      total += lendingPoolValue;
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
      totalBorrowed: totalDebt
    });

  }, [tokens, loans, liquidityInfo, totalCDPDebt]);

  return result;
};

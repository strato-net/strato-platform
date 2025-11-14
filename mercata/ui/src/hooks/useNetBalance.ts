import { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { Token, EarningAsset } from '@mercata/shared-types';

interface UseNetBalanceProps {
  tokens: EarningAsset[];
  cataToken?: Token | null;
  loans: any;
  totalCDPDebt: string;
}

interface NetBalanceResult {
  netBalance: number;
  cataBalance: number;
  totalBorrowed: number;
}

export const useNetBalance = ({
  tokens,
  cataToken,
  loans,
  totalCDPDebt,
}: UseNetBalanceProps): NetBalanceResult => {
  const [result, setResult] = useState<NetBalanceResult>({
    netBalance: 0,
    cataBalance: 0,
    totalBorrowed: 0
  });

  useEffect(() => {
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
      totalBorrowed: totalDebt
    });

  }, [tokens, cataToken, loans, totalCDPDebt]);

  return result;
};

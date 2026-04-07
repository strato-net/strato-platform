import { formatUnits } from 'viem';
import { Token } from '@mercata/shared-types';
import { useTokenContext } from '@/context/TokenContext';

interface UseNetBalanceProps {
  cataToken?: Token | null;
}

interface NetBalanceResult {
  netBalance: number;
  cataBalance: number;
  totalBorrowed: number;
  isLoading: boolean;
  refresh: () => void;
}

export const useNetBalance = ({
  cataToken,
}: UseNetBalanceProps): NetBalanceResult => {
  const { netBalance, totalBorrowed, loadingNetBalance, refreshNetBalance } = useTokenContext();

  let cataBalance = 0;
  if (cataToken?.balance) {
    try {
      cataBalance = parseFloat(formatUnits(BigInt(cataToken.balance), 18));
    } catch { /* invalid balance */ }
  }

  return {
    netBalance,
    cataBalance,
    totalBorrowed,
    isLoading: loadingNetBalance,
    refresh: refreshNetBalance,
  };
};

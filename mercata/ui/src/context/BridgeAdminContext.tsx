import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/axios";

interface Withdrawal {
  withdrawalId: string;
  WithdrawalInfo: any;
  block_timestamp?: string;
}

interface Deposit {
  externalChainId: string;
  externalTxHash: string;
  DepositInfo: any;
  block_timestamp?: string;
}

interface BridgeAdminContextType {
  withdrawals: Withdrawal[];
  withdrawalsTotalCount: number;
  loadingWithdrawals: boolean;
  errorWithdrawals: string | null;
  fetchWithdrawals: (page?: number, limit?: number) => Promise<void>;
  deposits: Deposit[];
  depositsTotalCount: number;
  loadingDeposits: boolean;
  errorDeposits: string | null;
  fetchDeposits: (page?: number, limit?: number) => Promise<void>;
}

const BridgeAdminContext = createContext<BridgeAdminContextType | undefined>(undefined);

const createFetchHandler = (
  endpoint: string,
  setData: (data: any[]) => void,
  setTotalCount: (count: number) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string | null) => void,
  errorMessage: string
) => async (page: number = 1, limit: number = 10) => {
  try {
    setLoading(true);
    setError(null);
    const offset = (page - 1) * limit;
    const { data } = await api.get(endpoint, {
      params: { limit: limit.toString(), offset: offset.toString() },
    });
    setData(data.data || []);
    setTotalCount(data.totalCount || 0);
  } catch (error: any) {
    setError(error.response?.data?.error || errorMessage);
    setData([]);
    setTotalCount(0);
  } finally {
    setLoading(false);
  }
};

export const BridgeAdminProvider = ({ children }: { children: ReactNode }) => {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [withdrawalsTotalCount, setWithdrawalsTotalCount] = useState(0);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [errorWithdrawals, setErrorWithdrawals] = useState<string | null>(null);
  
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [depositsTotalCount, setDepositsTotalCount] = useState(0);
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [errorDeposits, setErrorDeposits] = useState<string | null>(null);

  const fetchWithdrawals = useCallback(
    createFetchHandler(
      '/bridge/admin/withdrawals',
      setWithdrawals,
      setWithdrawalsTotalCount,
      setLoadingWithdrawals,
      setErrorWithdrawals,
      'Failed to fetch withdrawals'
    ),
    []
  );

  const fetchDeposits = useCallback(
    createFetchHandler(
      '/bridge/admin/deposits',
      setDeposits,
      setDepositsTotalCount,
      setLoadingDeposits,
      setErrorDeposits,
      'Failed to fetch deposits'
    ),
    []
  );

  return (
    <BridgeAdminContext.Provider
      value={{
        withdrawals,
        withdrawalsTotalCount,
        loadingWithdrawals,
        errorWithdrawals,
        fetchWithdrawals,
        deposits,
        depositsTotalCount,
        loadingDeposits,
        errorDeposits,
        fetchDeposits,
      }}
    >
      {children}
    </BridgeAdminContext.Provider>
  );
};

export const useBridgeAdminContext = (): BridgeAdminContextType => {
  const context = useContext(BridgeAdminContext);
  if (!context) throw new Error("useBridgeAdminContext must be used within a BridgeAdminProvider");
  return context;
};

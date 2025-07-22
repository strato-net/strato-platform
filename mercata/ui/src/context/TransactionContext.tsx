import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RawDepositData, RawWithdrawData } from '@/interface/index';
import { api } from '@/lib/axios';

interface Transaction {
  transaction_hash: string;
  block_timestamp: string;
  from: string;
  to: string;
  amount: string;
  txHash?: string;
  token?: string;
  key?: string;
  depositStatus?: string;
  withdrawalStatus?: string;
  tokenSymbol?: string;
  ethTokenName?: string;
  ethTokenSymbol?: string;
  ethTokenAddress?: string;
}

interface TransactionResponse {
  data: Transaction[];
  totalCount: number;
}

type TransactionContextType = {
  depositTransactions: Transaction[];
  withdrawTransactions: Transaction[];
  loading: boolean;
  error: string | null;
  fetchDepositTransactions: (params: {
    status: string;
    page: number;
    limit?: number;
  }) => Promise<TransactionResponse>;
  fetchWithdrawTransactions: (params: {
    status: string;
    page: number;
    limit?: number;
  }) => Promise<TransactionResponse>;
  formatDate: (dateString: string) => string;
  copyToClipboard: (text: string) => Promise<void>;
  renderTruncatedAddress: (address: string) => string;
  renderTransactionHash: (hash: string) => string;
};

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export const TransactionProvider = ({ children }: { children: ReactNode }) => {
  const [depositTransactions, setDepositTransactions] = useState<Transaction[]>([]);
  const [withdrawTransactions, setWithdrawTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDepositTransactions = useCallback(async ({
    status,
    page,
    limit = 10
  }: {
    status: string;
    page: number;
    limit?: number;
  }): Promise<TransactionResponse> => {
    setLoading(true);
    
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        pageNo: page.toString(),
        orderBy: 'block_timestamp',
        orderDirection: 'desc',
      });

      const response = await api.get(`/bridge/depositStatus/${status}?${params}`);
      const responseData = response.data;

      const depositData = responseData?.data?.data.data || [];
      
      const transformedData = Array.isArray(depositData)
        ? depositData.map((item: RawDepositData) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: item.from,
            to: item.to,
            tokenSymbol: item.tokenSymbol,
            ethTokenSymbol: item.ethTokenSymbol,
            ethTokenAddress: item.ethTokenAddress,
            amount: item.amount
              ? (
                  Number(item.amount) /
                   ( 10 ** 18)
                ).toLocaleString("fullwide", {
                  useGrouping: false,
                  maximumFractionDigits: 20,
                })
              : "-",
            txHash: item.txHash,
            token: item.token,
            key: item.key,
            depositStatus: item.depositStatus,
          }))
        : [];

      const totalCount = responseData?.data?.data?.totalCount || 0;
      
      setDepositTransactions(transformedData);
      
      return {
        data: transformedData,
        totalCount
      };
    } catch (err) {
  
      return {
        data: [],
        totalCount: 0
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWithdrawTransactions = useCallback(async ({
    status,
    page,
    limit = 10
  }: {
    status: string;
    page: number;
    limit?: number;
  }): Promise<TransactionResponse> => {
    setLoading(true);
    
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        pageNo: page.toString(),
        orderBy: 'block_timestamp',
        orderDirection: 'desc',
      });

      const response = await api.get(`/bridge/withdrawalStatus/${status}?${params}`);
      const responseData = response.data;

      const withdrawalData = responseData?.data?.data.data || [];
      
      const transformedData = Array.isArray(withdrawalData)
        ? withdrawalData.map((item: RawWithdrawData) => ({
            transaction_hash: item.transaction_hash,
            block_timestamp: item.block_timestamp,
            from: item.from,
            to: item.to,
            ethTokenSymbol: item.ethTokenSymbol,
            ethTokenAddress: item.ethTokenAddress,
            amount: item.amount
              ? (
                  Number(item.amount) /
                  (item.tokenDecimal ? 10 ** item.tokenDecimal : 1)
                ).toLocaleString("fullwide", {
                  useGrouping: false,
                  maximumFractionDigits: 20,
                })
              : "-",
            txHash: item.txHash,
            token: item.token,
            key: item.key,
            withdrawalStatus: item.withdrawalStatus,
            tokenSymbol: item.tokenSymbol,
          }))
        : [];

      const totalCount = responseData?.data?.data?.totalCount || 0;
      
      setWithdrawTransactions(transformedData);
      
      return {
        data: transformedData,
        totalCount
      };
    } catch (err) {
      return {
        data: [],
        totalCount: 0
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const formatDate = useCallback((dateString: string): string => {
    try {
      const isoString = dateString.replace(" UTC", "Z");
      const date = new Date(isoString);
      const relativeTime = formatDistanceToNow(date, { addSuffix: true });
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      if (date < sevenDaysAgo) {
        const indianDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
        return indianDate.toLocaleString("en-IN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
      }

      return relativeTime;
    } catch (error) {
      console.error("Error formatting date:", error);
      return dateString;
    }
  }, []);

  const copyToClipboard = useCallback(async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      throw error;
    }
  }, []);

  const renderTruncatedAddress = useCallback((address: string): string => {
    if (!address) return "-";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  const renderTransactionHash = useCallback((hash: string): string => {
    if (!hash) return "-";
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  }, []);

  return (
    <TransactionContext.Provider
      value={{
        depositTransactions,
        withdrawTransactions,
        loading,
        error,
        fetchDepositTransactions,
        fetchWithdrawTransactions,
        formatDate,
        copyToClipboard,
        renderTruncatedAddress,
        renderTransactionHash,
      }}
    >
      {children}
    </TransactionContext.Provider>
  );
};

export const useTransactionContext = (): TransactionContextType => {
  const context = useContext(TransactionContext);
  if (!context) throw new Error('useTransactionContext must be used within a TransactionProvider');
  return context;
}; 
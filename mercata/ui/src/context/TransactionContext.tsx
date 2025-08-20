import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RawDepositData, RawWithdrawData } from '@/interface/index';
import { api } from '@/lib/axios';
import { formatWeiAmount } from '@/utils/numberUtils';

interface Transaction {
  transaction_hash: string;
  block_timestamp: string;
  chainId?: number;
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

      const response = await api.get(`/bridge/status/${status}?${params}`);
      const responseData = response.data;

      // Try different response data paths to find the actual data
      let depositData = responseData?.data?.data?.data  || [];
      
      // If the response is directly an array (like your example data), use it directly
      if (Array.isArray(responseData)) {
        depositData = responseData;
      }
      
      
      const transformedData = Array.isArray(depositData)
        ? depositData.map((item: RawDepositData) => {
           
            return {
              transaction_hash: item.depositId?.toString() || item.transaction_hash || '-',
              block_timestamp: item.block_timestamp || new Date().toISOString(),
              chainId: typeof item.chainId === 'number' ? item.chainId : 0,
              from: '-',
              to:  item.depositInfo?.user || item.from || '-',
              tokenSymbol: item.tokenSymbol || '-',
              stratoTokenSymbol: item.stratoTokenSymbol || '-',
              stratoTokenAddress: item.stratoToken || '-',
              amount: item.depositInfo?.amount || item.amount
                ? formatWeiAmount(item.depositInfo?.amount || item.amount, 18)
                : "-",
              txHash: item.transaction_hash || '-',
              token: item.depositInfo?.token || item.token || '-',
              key: item.depositId?.toString() || item.key || '-',
              depositStatus: item.depositInfo?.bridgeStatus || item.depositStatus || '-',
            };
          })
        : [];
      


      const totalCount = responseData?.data?.data?.totalCount || responseData?.totalCount || depositData?.length || 0;
      
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

      const response = await api.get(`/bridge/status/${status}?${params}`);
      const responseData = response.data;

      // Handle new API response structure
      const withdrawalData = responseData?.data || responseData || [];
      
      const transformedData = Array.isArray(withdrawalData)
                  ? withdrawalData.map((item: RawWithdrawData) => ({
            transaction_hash: item.withdrawalId?.toString() || '-',
            block_timestamp: item.withdrawalInfo?.requestedAt || '-',
            destChainId: typeof item.withdrawalInfo?.destChainId === 'string' ? parseInt(item.withdrawalInfo.destChainId) : 0,
            from: item.withdrawalInfo?.user || '-', // From shows user address
            to: '-', // To shows dest address
            ethTokenSymbol: '-', // Not available in new data
            ethTokenAddress: item.extToken || '-', // Not available in new data
            amount: item.withdrawalInfo?.amount ? formatWeiAmount(item.withdrawalInfo.amount, 18) : '-', // Show amount in 18 decimals
            txHash: item.transaction_hash || '-', // Not available in new data
            token: item.withdrawalInfo?.token || '-',
            key: item.withdrawalId?.toString() || '-',
            withdrawalStatus: item.withdrawalInfo?.bridgeStatus || '-',
            tokenSymbol: '-', // Not available in new data
          }))
        : [];

      const totalCount = responseData?.totalCount || withdrawalData?.length || 0;
      
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
      // Handle Unix timestamp (seconds since epoch)
      if (/^\d{10,}$/.test(dateString)) {
        const timestamp = parseInt(dateString) * 1000; // Convert seconds to milliseconds
        const date = new Date(timestamp);
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
      }

      // Handle existing ISO string format
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
      return dateString;
    }
  }, []);

  const copyToClipboard = useCallback(async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
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
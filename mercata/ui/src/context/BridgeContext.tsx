import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { api } from "@/lib/axios";
import { formatBalance } from "@/utils/numberUtils";
import {
  BalanceResponse,
  BridgeResponse,
  NetworkSummary,
  BridgeContextType,
} from "@/lib/bridge/types";
import { NetworkConfig, BridgeToken, BridgeTransactionResponse, BridgeTransactionTab, WithdrawalRequestParams, TransactionResponse, AutoSaveRequestParams, WithdrawalSummaryResponse } from "@mercata/shared-types";

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  // ========== STATE ==========
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableNetworks, setAvailableNetworks] = useState<NetworkSummary[]>(
    [],
  );
  const [bridgeableTokens, setBridgeableTokens] = useState<BridgeToken[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<BridgeToken | null>(null);
  const [networksLoaded, setNetworksLoaded] = useState(false);
  const [targetTransactionTab, setTargetTransactionTab] = useState<BridgeTransactionTab | null>(null);
  const [withdrawalSummary, setWithdrawalSummary] = useState<WithdrawalSummaryResponse | null>(null);
  const [loadingWithdrawalSummary, setLoadingWithdrawalSummary] = useState(false);
  const [depositRefreshKey, setDepositRefreshKey] = useState(0);

  const triggerDepositRefresh = useCallback(() => {
    setDepositRefreshKey(prev => prev + 1);
  }, []);

  // ========== REFS ==========
  const withdrawalSummaryAbortControllerRef = useRef<AbortController | null>(null);

  // ========== NETWORK & TOKEN FUNCTIONS ==========
  const fetchTokensForChain = useCallback(
    async (chainId: string) => {
      try {
        const { data } = await api.get<BridgeToken[]>(
          `/bridge/bridgeableTokens/${chainId}`,
        );
        const tokens = Array.isArray(data) ? data : [];
        setBridgeableTokens(tokens);

        // Set initial token if none is selected
        if (tokens.length > 0 && !selectedToken) {
          setSelectedToken(tokens[0]);
        }
      } catch (e) {
        setBridgeableTokens([]);
      }
    },
    [selectedToken],
  );

  const loadNetworksAndTokens = useCallback(async () => {
    if (loading || networksLoaded) return;
    setLoading(true);

    try {
      const { data } = await api.get<NetworkConfig[]>(
        `/bridge/networkConfigs`,
      );

      const networks: NetworkSummary[] = (data || [])
        .filter((cfg) => cfg?.chainInfo?.enabled)
        .map((cfg) => ({
          chainId: cfg.externalChainId.toString(),
          chainName: cfg.chainInfo.chainName,
          enabled: cfg.chainInfo.enabled,
          depositRouter: cfg.chainInfo.depositRouter,
        }));

      setAvailableNetworks(networks);
      setNetworksLoaded(true);

      if (!selectedNetwork && networks.length > 0) {
        const defaultName = networks[0].chainName;
        setSelectedNetwork(defaultName);
        await fetchTokensForChain(networks[0].chainId);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchTokensForChain, loading, networksLoaded, selectedNetwork]);

  const handleSetSelectedNetwork = useCallback(
    async (networkName: string) => {
      setSelectedNetwork(networkName);
      setBridgeableTokens([]);

      const cfg = availableNetworks.find((n) => n.chainName === networkName);
      if (!cfg) return;

      await fetchTokensForChain(cfg.chainId);
    },
    [availableNetworks, fetchTokensForChain],
  );

  // ========== BALANCE FUNCTIONS ==========
  const fetchBalance = useCallback(
    async (
      tokenAddress: string,
      signal?: AbortSignal
    ): Promise<BalanceResponse> => {
      const addr = tokenAddress.startsWith("0x")
        ? tokenAddress.slice(2)
        : tokenAddress;
      const { data } = await api.get(`/tokens/balance?address=eq.${addr}`, {
        signal,
      });

      if (Array.isArray(data) && data[0]) {
        const tokenData = data[0];
        const balance = tokenData.balance ? String(tokenData.balance) : "0";

        return { balance };
      }

      return { balance: "0" };
    },
    []
  );

  const useBalance = useCallback((tokenAddress: string | null) => {
    const [data, setData] = useState<{ 
      balance: string; 
      formatted: string;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    const refetch = useCallback(async () => {
      if (!tokenAddress || !mountedRef.current) return;

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      setIsLoading(true);
      setIsError(false);
      setError(null);

      try {
        const { balance } = await fetchBalance(tokenAddress, abortControllerRef.current.signal);
        if (mountedRef.current && !abortControllerRef.current.signal.aborted) {
          const formatted = formatBalance(balance);
          setData({ balance, formatted });
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
          return;
        }
        if (mountedRef.current && !abortControllerRef.current.signal.aborted) {
          setIsError(true);
          setError(err instanceof Error ? err : new Error('Failed to fetch balance'));
        }
      } finally {
        if (mountedRef.current && !abortControllerRef.current.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, [tokenAddress, fetchBalance]);

    useEffect(() => {
      mountedRef.current = true;
      refetch();
      
      return () => {
        mountedRef.current = false;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }, [refetch]);

    return {
      data,
      isLoading,
      isError,
      error,
      refetch
    };
  }, [fetchBalance]);

  // ========== WITHDRAWAL FUNCTIONS ==========
  const fetchWithdrawalSummary = useCallback(
    async (showLoading: boolean = false) => {
      if (withdrawalSummaryAbortControllerRef.current) {
        withdrawalSummaryAbortControllerRef.current.abort();
      }

      withdrawalSummaryAbortControllerRef.current = new AbortController();

      if (showLoading) {
        setLoadingWithdrawalSummary(true);
      }

      try {
        const { data } = await api.get<WithdrawalSummaryResponse>(
          '/bridge/withdrawalSummary',
          { signal: withdrawalSummaryAbortControllerRef.current.signal }
        );
        
        if (!withdrawalSummaryAbortControllerRef.current.signal.aborted) {
          setWithdrawalSummary(data);
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
          return;
        }
      } finally {
        if (showLoading && !withdrawalSummaryAbortControllerRef.current?.signal.aborted) {
          setLoadingWithdrawalSummary(false);
        }
      }
    },
    []
  );

  const requestWithdrawal = useCallback(
    async (params: WithdrawalRequestParams): Promise<BridgeResponse> => {
      setLoading(true);
      try {
        const { data } = await api.post<TransactionResponse>(`/bridge/requestWithdrawal`, params);
        return { success: true, data };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const requestAutoSave = useCallback(
    async (params: AutoSaveRequestParams): Promise<TransactionResponse> => {
      setLoading(true);
      try {
        const { data } = await api.post<TransactionResponse>(`/bridge/requestAutoSave`, params);
        return data;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // ========== TRANSACTION FUNCTIONS ==========
  const fetchDepositTransactions = useCallback(
    async (rawParams: Record<string, string | undefined> = {}, context?: string): Promise<BridgeTransactionResponse> => {
      setLoading(true);
      
      try {
        const paramsObj: Record<string, string> = Object.fromEntries(
          Object.entries(rawParams).filter(([_, v]) => v !== undefined)
        );
        
        // Add 'context' parameter for admin view (only if explicitly provided)
        if (context === 'admin') {
          paramsObj.context = 'admin';
        }

        const params = new URLSearchParams(paramsObj);
        const response = await api.get(`/bridge/transactions/deposit?${params}`);
        const responseData = response.data;

        return {
          data: responseData?.data || responseData || [],
          totalCount: responseData?.totalCount || responseData?.length || 0
        };
      } catch (err) {
        return {
          data: [],
          totalCount: 0
        };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchWithdrawTransactions = useCallback(
    async (rawParams: Record<string, string | undefined> = {}, context?: string): Promise<BridgeTransactionResponse> => {
      setLoading(true);
      
      try {
        const paramsObj: Record<string, string> = Object.fromEntries(
          Object.entries(rawParams).filter(([_, v]) => v !== undefined)
        );
        
        // Add 'context' parameter for admin view (only if explicitly provided)
        if (context === 'admin') {
          paramsObj.context = 'admin';
        }

        const params = new URLSearchParams(paramsObj);
        const response = await api.get(`/bridge/transactions/withdrawal?${params}`);
        const responseData = response.data;

        return {
          data: responseData?.data || responseData || [],
          totalCount: responseData?.totalCount || responseData?.length || 0
        };
      } catch (err) {
        return {
          data: [],
          totalCount: 0
        };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Note: Balance polling is handled inside the useBalance hook (15s interval per token)

  // ========== PROVIDER ==========
  return (
    <BridgeContext.Provider
      value={{
        loading,
        error,
        availableNetworks,
        bridgeableTokens,
        selectedNetwork,
        selectedToken,
        targetTransactionTab,
        setTargetTransactionTab,
        requestWithdrawal,
        requestAutoSave,
        useBalance,
        setSelectedNetwork: handleSetSelectedNetwork,
        setSelectedToken,
        loadNetworksAndTokens,
        fetchDepositTransactions,
        fetchWithdrawTransactions,
        withdrawalSummary,
        loadingWithdrawalSummary,
        fetchWithdrawalSummary,
        depositRefreshKey,
        triggerDepositRefresh,
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
};

export const useBridgeContext = (): BridgeContextType => {
  const context = useContext(BridgeContext);
  if (!context)
    throw new Error("useBridgeContext must be used within a BridgeProvider");
  return context;
};

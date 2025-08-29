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
  Token,
  BridgeOutParams,
  BalanceResponse,
  BridgeResponse,
  NetworkConfigFromAPI,
  NetworkSummary,
  BridgeContextType,
  BridgeTransactionResponse,
} from "@/lib/bridge/types";

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableNetworks, setAvailableNetworks] = useState<NetworkSummary[]>(
    [],
  );
  const [bridgeableTokens, setBridgeableTokens] = useState<Token[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [networksLoaded, setNetworksLoaded] = useState(false);

  const fetchTokensForChain = useCallback(
    async (chainId: string) => {
      try {
        const { data } = await api.get<Token[]>(
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
        setError("Failed to load tokens for selected network");
      }
    },
    [selectedToken],
  );

  const loadNetworksAndTokens = useCallback(async () => {
    if (loading || networksLoaded) return;
    setLoading(true);

    try {
      const { data } = await api.get<NetworkConfigFromAPI[]>(
        `/bridge/networkConfigs`,
      );

      const networks: NetworkSummary[] = (data || [])
        .filter((cfg) => cfg?.chainInfo?.enabled)
        .map((cfg) => ({
          chainId: cfg.externalChainId,
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
    } catch (e) {
      setError("Failed to load networks");
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

  const bridgeOut = useCallback(
    async (params: BridgeOutParams): Promise<BridgeResponse> => {
      setLoading(true);
      try {
        const { data } = await api.post(`/bridge/bridgeOut`, params);
        return { success: true, data };
      } catch (e) {
        setError("Bridge out failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const redeemOut = useCallback(
    async (params: BridgeOutParams): Promise<BridgeResponse> => {
      setLoading(true);
      try {
        const { data } = await api.post(`/bridge/redeemOut`, params);
        return { success: true, data };
      } catch (e) {
        setError("Redeem out failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Internal balance fetching function used by useBalance hook
  const fetchBalance = useCallback(
    async (tokenAddress: string): Promise<BalanceResponse> => {
      try {
        const addr = tokenAddress.startsWith("0x")
          ? tokenAddress.slice(2)
          : tokenAddress;
        const { data } = await api.get(`/tokens/balance?address=eq.${addr}`);
        
        if (Array.isArray(data) && data[0]) {
          const tokenData = data[0];
          const balance = tokenData.balance ? String(tokenData.balance) : "0";
          const tokenLimit = tokenData.tokenLimit ? {
            maxPerTx: tokenData.tokenLimit.maxPerTx || "0",
            isUnlimited: tokenData.tokenLimit.isUnlimited || false
          } : undefined;
          
          return { balance, tokenLimit };
        }
        
        return { balance: "0" };
      } catch (e) {
        setError("Failed to fetch balance");
        throw e;
      }
    },
    [],
  );

  // Custom useBalance hook similar to wagmi's useBalance
  const useBalance = useCallback((tokenAddress: string | null) => {
    const [data, setData] = useState<{ 
      balance: string; 
      formatted: string;
      tokenLimit?: {
        maxPerTx: string;
        isUnlimited: boolean;
      };
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
        const { balance, tokenLimit } = await fetchBalance(tokenAddress);
        if (mountedRef.current && !abortControllerRef.current.signal.aborted) {
          const formatted = formatBalance(balance);
          setData({ balance, formatted, tokenLimit });
        }
      } catch (err) {
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

  const fetchDepositTransactions = useCallback(
    async (rawParams: Record<string, string | undefined> = {}): Promise<BridgeTransactionResponse> => {
      setLoading(true);
      
      try {
        const params = new URLSearchParams(
          Object.fromEntries(
            Object.entries(rawParams).filter(([_, v]) => v !== undefined)
          )
        );

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
    async (rawParams: Record<string, string | undefined> = {}): Promise<BridgeTransactionResponse> => {
      setLoading(true);
      
      try {
        const params = new URLSearchParams(
          Object.fromEntries(
            Object.entries(rawParams).filter(([_, v]) => v !== undefined)
          )
        );

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

  return (
    <BridgeContext.Provider
      value={{
        loading,
        error,
        availableNetworks,
        bridgeableTokens,
        selectedNetwork,
        selectedToken,
        bridgeOut,
        redeemOut,
        useBalance,
        setSelectedNetwork: handleSetSelectedNetwork,
        setSelectedToken,
        loadNetworksAndTokens,
        fetchDepositTransactions,
        fetchWithdrawTransactions,
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

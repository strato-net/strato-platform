import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { api } from "@/lib/axios";
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
          chainId: cfg.chainId,
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

  const getBalance = useCallback(
    async (tokenAddress: string): Promise<BalanceResponse> => {
      setLoading(true);
      try {
        const addr = tokenAddress.startsWith("0x")
          ? tokenAddress.slice(2)
          : tokenAddress;
        const { data } = await api.get(`/tokens/balance?address=eq.${addr}`);
        const balance =
          Array.isArray(data) && data[0]?.balance
            ? String(data[0].balance)
            : "0";
        return { balance };
      } catch (e) {
        setError("Failed to fetch balance");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const getTokenLimit = useCallback(
    async (tokenAddress: string) => {
      try {
        const { data } = await api.get(`/bridge/tokenLimit/${tokenAddress}`);
        return data;
      } catch (e) {
        setError("Failed to fetch token limit");
        throw e;
      }
    },
    [],
  );

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
        getBalance,
        getTokenLimit,
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

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api } from '@/lib/axios';

interface Token {
  stratoTokenAddress: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  chainId: string;
  enabled: boolean;
  extName: string;
  extToken: string;
  extSymbol: string;
  extDecimals: string;
}

interface BridgeOutParams {
  amount: string;
  destAddress: string;
  token: string;
  destChainId: string;
}

interface BalanceResponse { balance: string }

interface BridgeResponse {
  success: boolean;
  data?: unknown;
}

interface NetworkConfig {
  chainId: string;
  chainInfo: {
    custody: string;
    enabled: boolean;
    chainName: string;
    depositRouter: string;
    lastProcessedBlock: string;
  };
}

type NetworkSummary = {
  chainId: string;
  chainName: string;
  enabled: boolean;
  depositRouter: string;
};

export type BridgeContextType = {
  loading: boolean;
  error: string | null;
  availableNetworks: NetworkSummary[];
  bridgeableTokens: Token[];
  selectedNetwork: string | null;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  getBalance: (tokenAddress: string) => Promise<BalanceResponse>;
  setSelectedNetwork: (networkName: string) => void;
  loadNetworksAndTokens: () => Promise<void>;
};

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableNetworks, setAvailableNetworks] = useState<NetworkSummary[]>([]);
  const [bridgeableTokens, setBridgeableTokens] = useState<Token[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [networksLoaded, setNetworksLoaded] = useState(false);

  const fetchTokensForChain = useCallback(async (chainId: string) => {
    try {
      const { data } = await api.get<Token[]>(`/bridge/bridgeableTokens/${chainId}`);
      setBridgeableTokens(Array.isArray(data) ? data : []);
    } catch (e) {
      setBridgeableTokens([]);
      setError('Failed to load tokens for selected network');
    }
  }, []);

  const loadNetworksAndTokens = useCallback(async () => {
    if (loading || networksLoaded) return;
    setLoading(true);

    try {
      const { data } = await api.get<NetworkConfig[]>(`/bridge/networkConfigs`);

      const networks: NetworkSummary[] = (data || [])
        .filter(cfg => cfg?.chainInfo?.enabled)
        .map(cfg => ({
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
      setError('Failed to load networks');
    } finally {
      setLoading(false);
    }
  }, [fetchTokensForChain, loading, networksLoaded, selectedNetwork]);

  const handleSetSelectedNetwork = useCallback(async (networkName: string) => {
    setSelectedNetwork(networkName);
    setBridgeableTokens([]);

    const cfg = availableNetworks.find(n => n.chainName === networkName);
    if (!cfg) return;

    await fetchTokensForChain(cfg.chainId);
  }, [availableNetworks, fetchTokensForChain]);

  const bridgeOut = useCallback(async (params: BridgeOutParams): Promise<BridgeResponse> => {
    setLoading(true);
    try {
      const { data } = await api.post(`/bridge/bridgeOut`, params);
      return { success: true, data };
    } catch (e) {
      setError('Bridge out failed');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const getBalance = useCallback(async (tokenAddress: string): Promise<BalanceResponse> => {
    setLoading(true);
    try {
      const addr = tokenAddress.startsWith('0x') ? tokenAddress.slice(2) : tokenAddress;
      const { data } = await api.get(`/tokens/balance?address=eq.${addr}`);
      const balance = Array.isArray(data) && data[0]?.balance ? String(data[0].balance) : '0';
      return { balance };
    } catch (e) {
      setError('Failed to fetch balance');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <BridgeContext.Provider
      value={{
        loading,
        error,
        availableNetworks,
        bridgeableTokens,
        selectedNetwork,
        bridgeOut,
        getBalance,
        setSelectedNetwork: handleSetSelectedNetwork,
        loadNetworksAndTokens,
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
};

export const useBridgeContext = (): BridgeContextType => {
  const context = useContext(BridgeContext);
  if (!context) throw new Error('useBridgeContext must be used within a BridgeProvider');
  return context;
};
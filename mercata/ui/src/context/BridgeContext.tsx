import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { api } from '@/lib/axios';

interface Token {
  name: string;
  symbol: string;
  tokenAddress: string;
  decimals: number;
  icon: string;
  chainId: number;
  exchangeTokenSymbol?: string;
  exchangeTokenName?: string;
}

interface BridgeInParams {
  amount: string;
  fromAddress: string;
  tokenAddress: string;
  ethHash: string;
}

interface BridgeOutParams {
  amount: string;
  toAddress: string;
  tokenAddress: string;
}

interface BalanceResponse {
  balance: string;
}

interface BridgeResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

interface BridgeConfig {
  showTestnet: boolean;
  safeAddress: string;
}

type BridgeContextType = {
  // State
  bridgeInTokens: Token[];
  bridgeOutTokens: Token[];
  loading: boolean;
  error: string | null;
  config: BridgeConfig | null;
  
  // Bridge In Functions
  fetchBridgeInTokens: () => Promise<Token[]>;
  bridgeIn: (params: BridgeInParams) => Promise<BridgeResponse>;
  
  // Bridge Out Functions
  fetchBridgeOutTokens: () => Promise<Token[]>;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  getBalance: (tokenAddress: string) => Promise<BalanceResponse>;
  
  // Bridge Config Functions
  fetchBridgeConfig: () => Promise<BridgeConfig>;
  
  // Utility Functions
  formatBalance: (value: bigint | string, decimals: number) => string;
};

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  const [bridgeInTokens, setBridgeInTokens] = useState<Token[]>([]);
  const [bridgeOutTokens, setBridgeOutTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<BridgeConfig | null>(null);

  const formatBalance = useCallback((value: bigint | string, decimals: number): string => {
    if (typeof value === 'bigint') {
      const formattedBalance = Number(value) / Math.pow(10, decimals);
      return formattedBalance.toFixed(decimals);
    } else {
      const numericValue = parseFloat(value);
      if (isNaN(numericValue)) return "0";
      return numericValue.toFixed(decimals);
    }
  }, []);

  const fetchBridgeConfig = useCallback(async (): Promise<BridgeConfig> => {
    setLoading(true);
    
    try {
      const response = await api.get(`/bridge/config`);
      let bridgeConfig = response.data.data.data;
      if (!bridgeConfig) {
        bridgeConfig = response.data;
      }
      setConfig(bridgeConfig);
      return bridgeConfig;
    } catch (err) {
      throw err ;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBridgeInTokens = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    
    try {
      const response = await api.get(`/bridge/bridgeInTokens`);
      // Get tokens from the correct path
      let tokens = response.data.data.data.bridgeInTokens;
      // Ensure tokens is always an array
      if (!Array.isArray(tokens)) {
        tokens = [];
      }
      
      setBridgeInTokens(tokens);
      return tokens;
    } catch (err) {
      setBridgeInTokens([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const bridgeIn = useCallback(async (params: BridgeInParams): Promise<BridgeResponse> => {
    setLoading(true);
    
    try {
      const response = await api.post(`/bridge/bridgeIn`, params);

      return {
        success: true,
        data: response.data
      };
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBridgeOutTokens = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    
    try {
      const response = await api.get(`/bridge/bridgeOutTokens`);
      // Get tokens from the correct path
      let tokens = response.data.data.data.bridgeOutTokens;
      
      // Ensure tokens is always an array
      if (!Array.isArray(tokens)) {
        tokens = [];
      }
      
      setBridgeOutTokens(tokens);
      return tokens;
    } catch (err) {
      setBridgeOutTokens([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const bridgeOut = useCallback(async (params: BridgeOutParams): Promise<BridgeResponse> => {
    setLoading(true);
    
    try {
      const response = await api.post(`/bridge/bridgeOut`, params);

      return {
        success: true,
        data: response.data
      };
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getBalance = useCallback(async (tokenAddress: string): Promise<BalanceResponse> => {
    setLoading(true);
    
    try {
      const formattedTokenAddress = tokenAddress.startsWith("0x")
        ? tokenAddress
        : `0x${tokenAddress}`;
      const response = await api.get(`/bridge/balance/${formattedTokenAddress}`);
      return { balance: response.data.data.balance };
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <BridgeContext.Provider
      value={{
        bridgeInTokens,
        bridgeOutTokens,
        loading,
        error,
        config,
        fetchBridgeInTokens,
        bridgeIn,
        fetchBridgeOutTokens,
        bridgeOut,
        getBalance,
        fetchBridgeConfig,
        formatBalance,
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
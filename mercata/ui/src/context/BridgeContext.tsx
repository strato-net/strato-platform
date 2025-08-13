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

interface BridgeInParams {
  amount: string;
  fromAddress: string;
  tokenAddress: string;
  ethHash: string;
}

interface BridgeOutParams {
  amount: string;
  destAddress: string;
  token: string;
  destChainId: string;
}

interface BalanceResponse {
  balance: string;
}

interface BridgeResponse {
  success: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
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

type BridgeContextType = {
  // State
  loading: boolean;
  error: string | null;

  
  // Bridge Functions
  getBridgeableTokens: (chainId: string) => Promise<Token[]>;
  bridgeIn: (params: BridgeInParams) => Promise<BridgeResponse>;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  getBalance: (tokenAddress: string) => Promise<BalanceResponse>;
  
  // Bridge Config Functions

  getNetworkConfig: () => Promise<NetworkConfig[]>;
  
  // Utility Functions
  formatBalance: (value: bigint | string, decimals: number) => string;
};

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


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

 

  const getNetworkConfig = useCallback(async (): Promise<NetworkConfig[]> => {
    setLoading(true);
    console.log("Fetching network config");
    try {
      const response = await api.get(`/bridge/networkConfigs`);
      return response.data;
      console.log("Network config:", response.data);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getBridgeableTokens = useCallback(async (chainId: string): Promise<Token[]> => {
    setLoading(true);
    
    try {
      console.log(`🔍 Fetching bridgeable tokens for chainId: ${chainId}`);
      const response = await api.get(`/bridge/bridgeableTokens/${chainId}`);
      
      console.log('📡 Raw API Response:', response);
      console.log('📡 Response Data:', response.data);
      console.log('📡 Response Status:', response.status);
      
      // Transform the response to match expected Token interface
      let tokens = response.data || [];
      console.log('🔄 Tokens before transformation:', tokens);
   
      
      console.log('✅ Final transformed tokens:', tokens);
      return tokens;
    } catch (err) {
      console.error('❌ Error fetching bridgeable tokens:', err);
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
        ? tokenAddress.substring(2) // Remove 0x prefix
        : tokenAddress;
      const response = await api.get(`/tokens/balance?address=eq.${formattedTokenAddress}`);
      return { balance: response.data[0].balance };
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <BridgeContext.Provider
      value={{
        loading,
        error,
        getBridgeableTokens,
        bridgeIn,
        bridgeOut,
        getBalance,
        getNetworkConfig,
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
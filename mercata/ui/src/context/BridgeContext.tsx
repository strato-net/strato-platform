import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

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
  data?: any;
}

type BridgeContextType = {
  // State
  bridgeInTokens: Token[];
  bridgeOutTokens: Token[];
  loading: boolean;
  error: string | null;
  
  // Bridge In Functions
  fetchBridgeInTokens: () => Promise<Token[]>;
  bridgeIn: (params: BridgeInParams) => Promise<BridgeResponse>;
  
  // Bridge Out Functions
  fetchBridgeOutTokens: () => Promise<Token[]>;
  bridgeOut: (params: BridgeOutParams) => Promise<BridgeResponse>;
  getBalance: (tokenAddress: string) => Promise<BalanceResponse>;
  
  // Utility Functions
  formatBalance: (value: bigint | string, decimals: number) => string;
};

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export const BridgeProvider = ({ children }: { children: ReactNode }) => {
  const [bridgeInTokens, setBridgeInTokens] = useState<Token[]>([]);
  const [bridgeOutTokens, setBridgeOutTokens] = useState<Token[]>([]);
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

  const fetchBridgeInTokens = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/bridge/bridgeInTokens`);
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to fetch bridge in tokens');
      }
      
      const tokens = responseData.data.data.bridgeInTokens;
      setBridgeInTokens(tokens);
      return tokens;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch bridge in tokens';
      setError(errorMessage);
      console.error('Error fetching bridge in tokens:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const bridgeIn = useCallback(async (params: BridgeInParams): Promise<BridgeResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/bridge/bridgeIn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || "Bridge transaction failed");
      }

      return {
        success: true,
        data: responseData.data
      };
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Bridge transaction failed";
      setError(errorMessage);
      console.error("Bridge API error:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBridgeOutTokens = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/bridge/bridgeOutTokens`);
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || 'Failed to fetch bridge out tokens');
      }
      
      const tokens = responseData.data.data.bridgeOutTokens;
      setBridgeOutTokens(tokens);
      return tokens;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to fetch bridge out tokens';
      setError(errorMessage);
      console.error('Error fetching bridge out tokens:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const bridgeOut = useCallback(async (params: BridgeOutParams): Promise<BridgeResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/bridge/bridgeOut`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || "Bridge transaction failed");
      }

      return {
        success: true,
        data: responseData.data
      };
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Bridge transaction failed";
      setError(errorMessage);
      console.error("Bridge API error:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getBalance = useCallback(async (tokenAddress: string): Promise<BalanceResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const formattedTokenAddress = tokenAddress.startsWith("0x")
        ? tokenAddress
        : `0x${tokenAddress}`;

      const response = await fetch(`/api/bridge/balance/${formattedTokenAddress}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      
      const responseData = await response.json();
      
      if (!response.ok) {
        throw new Error(responseData.error || "Failed to fetch balance");
      }
      
      return responseData.data;
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Failed to fetch balance";
      setError(errorMessage);
      console.error("Balance API error:", err);
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
        fetchBridgeInTokens,
        bridgeIn,
        fetchBridgeOutTokens,
        bridgeOut,
        getBalance,
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
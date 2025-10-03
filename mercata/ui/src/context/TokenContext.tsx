import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { api } from '@/lib/axios';
import { Token, CreateTokenPayload } from '@/interface';

type TokenContextType = {
  tokens: Token[];
  activeTokens: Token[];
  loading: boolean;
  error: string | null;
  getAllTokens: (query?: Record<string, string>) => Promise<void>;
  getActiveTokens: () => Promise<void>;
  getToken: (address: string) => Promise<Token | null>;
  getUserTokensWithBalance: () => Promise<Token[]>;
  createToken: (token: CreateTokenPayload) => Promise<void>;
  transferToken: (payload: { address: string; to: string; value: string }) => Promise<void>;
  approveToken: (payload: { address: string; spender: string; value: string }) => Promise<void>;
  transferFromToken: (payload: { address: string; from: string; to: string; value: string }) => Promise<void>;
  setTokenStatus: (payload: { address: string; status: number }) => Promise<void>;
};

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: ReactNode }) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [activeTokens, setActiveTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAllTokens = useCallback(async (query: Record<string, string> = {}) => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>('/tokens', { params: query });
      setTokens(res.data || []);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, []);

  const getActiveTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>('/tokens', { params: { status: 'eq.2' } });
      setActiveTokens(res.data || []);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, []);

  const getToken = useCallback(async (address: string): Promise<Token | null> => {
    setLoading(true);
    try {
      const res = await api.get<Token>(`/tokens/${address}`);
      return res.data;
    } catch (err) {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Only ACTIVE tokens with positive balance; PENDING and LEGACY tokens are excluded
  const getUserTokensWithBalance = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>(`/tokens/balance?value=gt.0`);
      const activeTokens = (res.data || []).filter(token => token.status === '2');
      return activeTokens;
    } catch (err) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const createToken = useCallback(async (token: CreateTokenPayload) => {
    setLoading(true);
    try {
      const payload = {
        name: token.name,
        symbol: token.symbol,
        initialSupply: token.initialSupply,
        description: token.description,
        customDecimals: token.customDecimals,
        images: JSON.stringify(token.images || []),
        files: JSON.stringify(token.files || []),
        fileNames: JSON.stringify(token.fileNames || []),
      };
      await api.post('/tokens', payload);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const transferToken = useCallback(async (payload: { address: string; to: string; value: string }) => {
    setLoading(true);
    try {
      await api.post('/tokens/transfer', payload);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const approveToken = useCallback(async (payload: { address: string; spender: string; value: string }) => {
    setLoading(true);
    try {
      await api.post('/tokens/approve', payload);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const transferFromToken = useCallback(async (payload: { address: string; from: string; to: string; value: string }) => {
    setLoading(true);
    try {
      await api.post('/tokens/transferFrom', payload);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const setTokenStatus = useCallback(async (payload: { address: string; status: number }) => {
    setLoading(true);
    try {
      await api.post('/tokens/setStatus', payload);
      // Refresh tokens to reflect the status change immediately
      await getAllTokens();
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAllTokens]);

  useEffect(() => {
    getAllTokens();
  }, [getAllTokens]);

  return (
    <TokenContext.Provider
      value={{
        tokens,
        activeTokens,
        loading,
        error,
        getAllTokens,
        getActiveTokens,
        getToken,
        getUserTokensWithBalance,
        createToken,
        transferToken,
        approveToken,
        transferFromToken,
        setTokenStatus,
      }}
    >
      {children}
    </TokenContext.Provider>
  );
};

export const useTokenContext = (): TokenContextType => {
  const context = useContext(TokenContext);
  if (!context) throw new Error('useTokenContext must be used within a TokenProvider');
  return context;
};

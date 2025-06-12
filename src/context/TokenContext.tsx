import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import { api } from '@/lib/axios';
import { Token, CreateTokenValues } from '@/interface';

type TokenContextType = {
  tokens: Token[];
  loading: boolean;
  error: string | null;
  getAllTokens: (query?: Record<string, string>) => Promise<void>;
  getToken: (address: string) => Promise<Token | null>;
  createToken: (token: CreateTokenValues) => Promise<void>;
  transferToken: (payload: { address: string; to: string; value: string }) => Promise<void>;
  approveToken: (payload: { address: string; spender: string; value: string }) => Promise<void>;
  transferFromToken: (payload: { address: string; from: string; to: string; value: string }) => Promise<void>;
};

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: ReactNode }) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAllTokens = useCallback(async (query: Record<string, string> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Token[]>('/tokens', { params: query });
      setTokens(res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  const getToken = useCallback(async (address: string): Promise<Token | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Token>(`/tokens/${address}`);
      return res.data;
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch token');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const createToken = useCallback(async (token: CreateTokenValues) => {
    setLoading(true);
    setError(null);
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
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to create token');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const transferToken = useCallback(async (payload: { address: string; to: string; value: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/tokens/transfer', payload);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to transfer token');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const approveToken = useCallback(async (payload: { address: string; spender: string; value: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/tokens/approve', payload);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to approve token');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const transferFromToken = useCallback(async (payload: { address: string; from: string; to: string; value: string }) => {
    setLoading(true);
    setError(null);
    try {
      await api.post('/tokens/transferFrom', payload);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to transfer from token');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getAllTokens();
  }, [getAllTokens]);

  return (
    <TokenContext.Provider
      value={{
        tokens,
        loading,
        error,
        getAllTokens,
        getToken,
        createToken,
        transferToken,
        approveToken,
        transferFromToken,
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

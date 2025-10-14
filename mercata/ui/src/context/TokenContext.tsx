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
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  activePagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  getAllTokens: (page?: number, limit?: number, query?: Record<string, string>) => Promise<void>;
  getActiveTokens: (page?: number, limit?: number) => Promise<void>;
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
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  });
  const [activePagination, setActivePagination] = useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  });

  const getAllTokens = useCallback(async (page = 1, limit = 20, query: Record<string, string> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * limit;
      const params = {
        ...query,
        limit: limit.toString(),
        offset: offset.toString(),
      };
      const res = await api.get('/tokens', { params });
      setTokens(res.data.data || []);
      setPagination(res.data.pagination || {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  const getActiveTokens = useCallback(async (page = 1, limit = 20) => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * limit;
      const params = {
        status: 'eq.2',
        limit: limit.toString(),
        offset: offset.toString(),
      };
      const res = await api.get('/tokens', { params });
      setActiveTokens(res.data.data || []);
      setActivePagination(res.data.pagination || {
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to fetch active tokens');
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

  const getUserTokensWithBalance = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>(`/tokens/balance?value=gt.0`);
      return res.data || [];
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
        pagination,
        activePagination,
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

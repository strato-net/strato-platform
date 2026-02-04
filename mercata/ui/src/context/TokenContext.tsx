import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { api } from '@/lib/axios';
import { Token, CreateTokenPayload } from '@/interface';
import { Token as TokenType, EarningAsset, BalanceSnapshot } from '@mercata/shared-types';
import { cataAddress, usdstAddress } from '@/lib/constants';
import { useUser } from '@/context/UserContext';

type TokenContextType = {
  tokens: Token[];
  activeTokens: Token[];
  inactiveTokens: TokenType[];
  earningAssets: EarningAsset[];
  balanceHistory: BalanceSnapshot[];
  cataBalanceHistory: BalanceSnapshot[];
  borrowingHistory: BalanceSnapshot[];
  loading: boolean;
  error: string | null;
  getAllTokens: (query?: Record<string, string>) => Promise<void>;
  getActiveTokens: () => Promise<void>;
  getInactiveTokens: (showLoading?: boolean) => Promise<void>;
  getToken: (address: string) => Promise<Token | null>;
  getUserTokensWithBalance: () => Promise<Token[]>;
  getTransferableTokens: () => Promise<Token[]>;
  getEarningAssets: (showLoading?: boolean) => Promise<void>;
  getBalanceHistory: (duration?: string, end?: string) => Promise<BalanceSnapshot[]>;
  getCataBalanceHistory: (duration?: string, end?: string) => Promise<BalanceSnapshot[]>;
  getBorrowingHistory: (duration?: string, end?: string) => Promise<BalanceSnapshot[]>;
  loadingEarningAssets: boolean;
  loadingInactiveTokens: boolean;
  createToken: (token: CreateTokenPayload) => Promise<void>;
  transferToken: (payload: { address: string; to: string; value: string }) => Promise<void>;
  approveToken: (payload: { address: string; spender: string; value: string }) => Promise<void>;
  transferFromToken: (payload: { address: string; from: string; to: string; value: string }) => Promise<void>;
  setTokenStatus: (payload: { address: string; status: number }) => Promise<void>;
  // USDST balance
  usdstBalance: string;
  voucherBalance: string;
  loadingUsdstBalance: boolean;
  fetchUsdstBalance: (signal?: AbortSignal) => Promise<void>;
  // Balance history caches
  netBalanceHistoryCache: Record<string, BalanceSnapshot[]>;
  rewardsHistoryCache: Record<string, BalanceSnapshot[]>;
  borrowedHistoryCache: Record<string, BalanceSnapshot[]>;
  loadingBalanceHistory: boolean;
  setNetBalanceHistoryCache: (range: string, data: BalanceSnapshot[]) => void;
  setRewardsHistoryCache: (range: string, data: BalanceSnapshot[]) => void;
  setBorrowedHistoryCache: (range: string, data: BalanceSnapshot[]) => void;
  setLoadingBalanceHistory: (loading: boolean) => void;
};

const TokenContext = createContext<TokenContextType | undefined>(undefined);

export const TokenProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [activeTokens, setActiveTokens] = useState<Token[]>([]);
  const [inactiveTokens, setInactiveTokens] = useState<TokenType[]>([]);
  const [earningAssets, setEarningAssets] = useState<EarningAsset[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [cataBalanceHistory, setCataBalanceHistory] = useState<BalanceSnapshot[]>([]);
  const [borrowingHistory, setBorrowingHistory] = useState<BalanceSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingEarningAssets, setLoadingEarningAssets] = useState(false);
  const [loadingInactiveTokens, setLoadingInactiveTokens] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // USDST balance state
  const [usdstBalance, setUsdstBalance] = useState("0");
  const [voucherBalance, setVoucherBalance] = useState("0");
  const [loadingUsdstBalance, setLoadingUsdstBalance] = useState(false);
  
  // Balance history caches
  const [netBalanceHistoryCache, setNetBalanceHistoryCacheState] = useState<Record<string, BalanceSnapshot[]>>({});
  const [rewardsHistoryCache, setRewardsHistoryCacheState] = useState<Record<string, BalanceSnapshot[]>>({});
  const [borrowedHistoryCache, setBorrowedHistoryCacheState] = useState<Record<string, BalanceSnapshot[]>>({});
  const [loadingBalanceHistory, setLoadingBalanceHistory] = useState(false);

  // ========== REFS ==========
  const earningAssetsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const earningAssetsAbortControllerRef = useRef<AbortController | null>(null);
  const inactiveTokensAbortControllerRef = useRef<AbortController | null>(null);

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

  const getInactiveTokens = useCallback(async (showLoading: boolean = false) => {
    if (inactiveTokensAbortControllerRef.current) {
      inactiveTokensAbortControllerRef.current.abort();
    }

    inactiveTokensAbortControllerRef.current = new AbortController();

    if (showLoading) {
      setLoadingInactiveTokens(true);
    }

    try {
      const res = await api.get<{ tokens: TokenType[]; totalCount: number }>(
        `/tokens/v2`,
        { 
          params: { status: 'neq.2' },
          signal: inactiveTokensAbortControllerRef.current.signal
        }
      );
      
      if (!inactiveTokensAbortControllerRef.current.signal.aborted) {
      setInactiveTokens(res.data?.tokens || []);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        return;
      }
    } finally {
      if (showLoading && !inactiveTokensAbortControllerRef.current?.signal.aborted) {
        setLoadingInactiveTokens(false);
      }
    }
  }, []);

  const getToken = useCallback(async (address: string): Promise<Token | null> => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>(`/tokens/${address}`);
      // Backend returns an array, so take the first element
      return Array.isArray(res.data) ? res.data[0] || null : res.data;
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

  const getTransferableTokens = useCallback(async (): Promise<Token[]> => {
    setLoading(true);
    try {
      const res = await api.get<Token[]>(`/tokens/transferable`);
      return res.data || [];
    } catch (err) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // ========== USDST BALANCE FUNCTIONS ==========
  const fetchUsdstBalance = useCallback(async (signal?: AbortSignal) => {
    setLoadingUsdstBalance(true);
    try {
      const [usdstResponse, voucherResponse] = await Promise.all([
        api.get(`/tokens/balance`, {
          signal,
          params: { address: `eq.${usdstAddress}` },
        }),
        api.get(`/vouchers/balance`, {
          signal,
        }),
      ]);

      if (signal?.aborted) return;

      setUsdstBalance(usdstResponse?.data?.[0]?.balance || "0");
      setVoucherBalance(voucherResponse?.data?.balance || "0");
    } catch (err) {
      if (signal?.aborted) return;
      setUsdstBalance("0");
      setVoucherBalance("0");
    } finally {
      if (!signal?.aborted) {
        setLoadingUsdstBalance(false);
      }
    }
  }, []);

  const getEarningAssets = useCallback(async (showLoading: boolean = false) => {
    if (earningAssetsAbortControllerRef.current) {
      earningAssetsAbortControllerRef.current.abort();
    }

    earningAssetsAbortControllerRef.current = new AbortController();

    if (showLoading) {
      setLoadingEarningAssets(true);
    }

    try {
      // Use different API endpoints based on login status
      const endpoint = isLoggedIn ? `/tokens/v2/earning-assets` : `/tokens/v2/earning-assets/public`;
      const res = await api.get<EarningAsset[]>(
        endpoint,
        { signal: earningAssetsAbortControllerRef.current.signal }
      );
      
      if (!earningAssetsAbortControllerRef.current.signal.aborted) {
        setEarningAssets(res.data || []);
        
        // Find USDST token from earning assets and update balance (only for logged-in users)
        if (isLoggedIn) {
          const usdstToken = res.data?.find((asset) => asset.address === usdstAddress);
          if (usdstToken) {
            setUsdstBalance(usdstToken.balance || "0");
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        return;
      }
    } finally {
      if (showLoading && !earningAssetsAbortControllerRef.current?.signal.aborted) {
        setLoadingEarningAssets(false);
      }
    }
  }, [isLoggedIn]);

  const getCataBalanceHistory = useCallback(async (duration: string = '1d', end?: string): Promise<BalanceSnapshot[]> => {
    setLoading(true);
    try {
      const query = `?duration=${duration}${end ? `&end=${end}` : ''}`;
      const res = await api.get<BalanceSnapshot[]>(`/tokens/v2/balance-history/${cataAddress}${query}`);
      const data = res.data || [];
      setCataBalanceHistory(data);
      return data;
    } catch (err) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getBalanceHistory = useCallback(async (duration: string = '1d', end?: string): Promise<BalanceSnapshot[]> => {
    setLoading(true);
    try {
      const query = `?duration=${duration}${end ? `&end=${end}` : ''}`;
      const res = await api.get<BalanceSnapshot[]>(`/tokens/v2/net-balance-history${query}`);
      const data = res.data || [];
      setBalanceHistory(data);
      return data;
    } catch (err) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getBorrowingHistory = useCallback(async (duration: string = '1d', end?: string): Promise<BalanceSnapshot[]> => {
    setLoading(true);
    try {
      const query = `?duration=${duration}${end ? `&end=${end}` : ''}`;
      const res = await api.get<BalanceSnapshot[]>(`/tokens/v2/borrowing-history${query}`);
      const data = res.data || [];
      setBorrowingHistory(data);
      return data;
    } catch (err) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const setNetBalanceHistoryCache = useCallback((range: string, data: BalanceSnapshot[]) => {
    setNetBalanceHistoryCacheState(prev => ({ ...prev, [range]: data }));
  }, []);

  const setRewardsHistoryCache = useCallback((range: string, data: BalanceSnapshot[]) => {
    setRewardsHistoryCacheState(prev => ({ ...prev, [range]: data }));
  }, []);

  const setBorrowedHistoryCache = useCallback((range: string, data: BalanceSnapshot[]) => {
    setBorrowedHistoryCacheState(prev => ({ ...prev, [range]: data }));
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

  // ========== POLLING EFFECTS ==========
  // Earning assets - fetch once on mount for all users, poll only for logged-in users
  useEffect(() => {
    // Always fetch earning assets once (works for guests too - returns public data)
    getEarningAssets(true);

    // Only set up polling interval for logged-in users
    if (isLoggedIn) {
      earningAssetsIntervalRef.current = setInterval(() => {
        getEarningAssets(false);
      }, 30000);
    }

    return () => {
      if (earningAssetsIntervalRef.current) {
        clearInterval(earningAssetsIntervalRef.current);
        earningAssetsIntervalRef.current = null;
      }
      if (earningAssetsAbortControllerRef.current) {
        earningAssetsAbortControllerRef.current.abort();
      }
    };
  }, [getEarningAssets, isLoggedIn]);


  return (
    <TokenContext.Provider
      value={{
        tokens,
        activeTokens,
        inactiveTokens,
        earningAssets,
        balanceHistory,
        cataBalanceHistory,
        borrowingHistory,
        loading,
        error,
        getAllTokens,
        getActiveTokens,
        getInactiveTokens,
        getToken,
        getUserTokensWithBalance,
        getTransferableTokens,
        getEarningAssets,
        getBalanceHistory,
        getCataBalanceHistory,
        getBorrowingHistory,
        createToken,
        transferToken,
        approveToken,
        transferFromToken,
        setTokenStatus,
        loadingEarningAssets,
        loadingInactiveTokens,
        usdstBalance,
        voucherBalance,
        loadingUsdstBalance,
        fetchUsdstBalance,
        netBalanceHistoryCache,
        rewardsHistoryCache,
        borrowedHistoryCache,
        loadingBalanceHistory,
        setNetBalanceHistoryCache,
        setRewardsHistoryCache,
        setBorrowedHistoryCache,
        setLoadingBalanceHistory,
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

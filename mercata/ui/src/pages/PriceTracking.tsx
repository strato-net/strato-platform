import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import { useTokenContext } from '@/context/TokenContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { api } from '@/lib/axios';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import MobileBottomNav from '@/components/dashboard/MobileBottomNav';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CandlestickChart, { OHLCData } from '@/components/charts/CandlestickChart';
import { Loader2, TrendingUp, TrendingDown, Search, ArrowUp, ArrowDown, GripVertical, CircleDollarSign } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EarningAsset } from '@mercata/shared-types';
import { format } from 'date-fns';
import FixedSwapWidget from '@/components/swap/FixedSwapWidget';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress } from '@/lib/constants';
import { SwapToken } from '@/interface';
import { calculateSwapOutput } from '@/helpers/swapCalculations';
import { formatUnits, safeParseUnits } from '@/utils/numberUtils';
import type { Pool } from '@/interface';

type TimeRange = '1h' | '1d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'all';
type Interval = '10s' | '5m' | '15m' | '1h' | '4h' | '1d';
type ChartType = 'line' | 'candlestick';

interface AssetPriceData {
  asset: EarningAsset | { address: string; symbol: string; isPoolToken: boolean };
  data: OHLCData[];
  loading: boolean;
  error?: string;
  currentPrice: number;
  change24h: number;
  changePercent24h: number;
}

interface WidgetConfig {
  id: string;
  assetAddress: string | null;
  timeRange: TimeRange;
  interval: Interval;
  chartType: ChartType;
  showSpotPrice?: boolean; // When true and pool has spot data, show spot price line. Default true.
}

const TIME_RANGES: TimeRange[] = ['1h', '1d', '7d', '1m', '3m', '6m', '1y', 'all'];
const INTERVALS: Interval[] = ['10s', '5m', '15m', '1h', '4h', '1d'];

// Default intervals for each time range
const DEFAULT_INTERVALS: Record<TimeRange, Interval> = {
  '1h': '10s',
  '1d': '5m',
  '7d': '15m',
  '1m': '1h',
  '3m': '4h',
  '6m': '4h',
  '1y': '1d',
  'all': '1d',
};

// Convert price history to OHLC candles
const convertToOHLC = (
  priceHistory: Array<{ timestamp: number; price: string }>,
  intervalMs: number
): OHLCData[] => {
  if (priceHistory.length === 0) return [];

  // Group prices by interval
  const candles = new Map<number, number[]>();

  priceHistory.forEach((point) => {
    const intervalStart = Math.floor(point.timestamp / intervalMs) * intervalMs;
    if (!candles.has(intervalStart)) {
      candles.set(intervalStart, []);
    }
    // Price might already be in decimal format or in wei - try both
    let price = parseFloat(point.price);
    // If price is very large, assume it's in wei and convert
    if (price > 1e10) {
      price = price / 1e18;
    }
    candles.get(intervalStart)!.push(price);
  });

  // Convert to OHLC format
  const ohlcData: OHLCData[] = [];
  const sortedIntervals = Array.from(candles.keys()).sort((a, b) => a - b);

  sortedIntervals.forEach((intervalStart, index) => {
    const prices = candles.get(intervalStart)!;
    if (prices.length === 0) return;

    const open = index > 0 ? ohlcData[index - 1].close : prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const close = prices[prices.length - 1];

    ohlcData.push({
      timestamp: intervalStart,
      open,
      high,
      low,
      close,
      volume: prices.length, // Use count as volume proxy
    });
  });

  return ohlcData;
};

const WIDGET_STORAGE_KEY = 'price-tracking-widgets';

const PriceTracking = () => {
  const { earningAssets, usdstBalance } = useTokenContext();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { setFromAsset, setToAsset, swappableTokens, refetchSwappableTokens, fetchPairableTokens, getPoolByTokenPair, getPoolByAddress } = useSwapContext();
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapMode, setSwapMode] = useState<'buy' | 'sell' | 'arb' | null>(null);
  const [swapAsset, setSwapAsset] = useState<EarningAsset | null>(null);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken | null>(null);
  const [swapToToken, setSwapToToken] = useState<SwapToken | null>(null);
  const [swapInitialFromAmount, setSwapInitialFromAmount] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(() => {
    // Try to load from localStorage first
    try {
      const saved = localStorage.getItem(WIDGET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 8) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('Failed to load widgets from localStorage:', error);
    }

    // Default configuration: tokens on top row, pools on bottom row
    // We'll set the actual addresses after assets are loaded
    return Array.from({ length: 8 }, (_, i) => ({
      id: `widget-${i}`,
      assetAddress: null,
      timeRange: '1d' as TimeRange,
      interval: '5m' as Interval,
      chartType: 'line' as ChartType,
      showSpotPrice: true,
    }));
  });
  const [assetData, setAssetData] = useState<Map<string, AssetPriceData>>(new Map());
  const [availableAssets, setAvailableAssets] = useState<EarningAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  // Use ref for hover data to prevent chart rerenders - only the text component will update
  const hoveredDataByWidgetRef = useRef<Map<string, any>>(new Map());
  const [hoverUpdateKey, setHoverUpdateKey] = useState(0);

  // Fetch swappable tokens when component mounts
  useEffect(() => {
    refetchSwappableTokens();
  }, [refetchSwappableTokens]);

  // Convert EarningAsset to SwapToken format
  const convertToSwapToken = useCallback((asset: EarningAsset): SwapToken | null => {
    if (!asset.address) return null;

    // Find the asset in swappableTokens first (has all the pool info)
    const swapToken = swappableTokens.find(t => t.address.toLowerCase() === asset.address.toLowerCase());
    if (swapToken) {
      return swapToken;
    }

    // Otherwise create a basic SwapToken from EarningAsset
    return {
      address: asset.address,
      _symbol: asset.symbol,
      symbol: asset.symbol,
      balance: asset.balance || '0',
      poolBalance: '0',
      decimals: 18, // Default, might need adjustment
    };
  }, [swappableTokens]);

  // Check if user has balance for an asset
  // For pools, always return false (can't sell a pool directly)
  // For tokens/LP tokens, check the balance from activeTokens only (don't trust asset.balance)
  const hasAssetBalance = useCallback((asset: EarningAsset): boolean => {
    // Pools can't be sold directly
    if ((asset as any).isPool === true) {
      return false;
    }
    if (!asset.address) return false;

    // Only check activeTokens for user balance - this is the source of truth
    // Don't use asset.balance as it may contain pool/token balances, not user balances
    const token = activeTokens.find((t: any) => {
      const address = t.address || t.token?.address;
      return address?.toLowerCase() === asset.address.toLowerCase();
    });

    if (token) {
      const balance = token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';
      const balanceBigInt = BigInt(balance);
      return balanceBigInt > 0n;
    }

    // No balance found in activeTokens means user doesn't own it
    return false;
  }, [activeTokens]);

  // Check if user has USDST balance
  const hasUsdstBalance = useMemo(() => {
    if (!usdstBalance) return false;
    // Balance is in wei, so we need to check if it's > 0
    const balance = BigInt(usdstBalance || '0');
    return balance > 0n;
  }, [usdstBalance]);

  // Check if user has balance for a specific token address
  const hasTokenBalance = useCallback((tokenAddress: string | undefined): boolean => {
    if (!tokenAddress) return false;
    
    // Check activeTokens for user balance
    const token = activeTokens.find((t: any) => {
      const address = t.address || t.token?.address;
      return address?.toLowerCase() === tokenAddress.toLowerCase();
    });
    
    if (token) {
      const balance = token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';
      const balanceBigInt = BigInt(balance);
      return balanceBigInt > 0n;
    }
    
    return false;
  }, [activeTokens]);

  // Return user balance (wei string) for a token address
  const getTokenBalanceWei = useCallback((tokenAddress: string | undefined): string => {
    if (!tokenAddress) return '0';
    const token = activeTokens.find((t: any) => {
      const address = t.address || t.token?.address;
      return address?.toLowerCase() === tokenAddress.toLowerCase();
    });
    if (!token) return '0';
    return token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';
  }, [activeTokens]);

  // Compute arb-from amount (wei string) to align pool with oracle, capped by user balance
  const computeArbFromAmountWei = useCallback((pool: Pool, isAToB: boolean, oracleRatio: number, userBalanceWei: string): string => {
    const inReserve = isAToB
      ? BigInt(pool.tokenA?.poolBalance || '0')
      : BigInt(pool.tokenB?.poolBalance || '0');
    const outReserve = isAToB
      ? BigInt(pool.tokenB?.poolBalance || '0')
      : BigInt(pool.tokenA?.poolBalance || '0');
    const userWei = BigInt(userBalanceWei || '0');
    const cap = inReserve < 1n ? 0n : (userWei < inReserve ? userWei : inReserve);
    if (cap <= 0n || oracleRatio <= 0 || !Number.isFinite(oracleRatio)) return '0';
    const feeRate = BigInt(pool.swapFeeRate || 0);
    let lo = 0n;
    let hi = cap;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2n;
      if (mid <= 0n) break;
      try {
        const out = BigInt(calculateSwapOutput(mid.toString(), pool, isAToB));
        const netIn = mid - (mid * feeRate) / 10000n;
        const denom = inReserve + netIn;
        if (denom <= 0n) break;
        const newRatio = Number(outReserve - out) / Number(denom);
        if (newRatio > oracleRatio) lo = mid;
        else hi = mid;
      } catch {
        hi = mid;
      }
    }
    return lo.toString();
  }, []);

  // Handle opening swap modal for ARB: prefills amounts to align pool with spot
  const handleOpenArb = useCallback(async (asset: EarningAsset) => {
    const isPool = (asset as any).isPool === true;
    if (!isPool) return;
    if (swappableTokens.length === 0) await refetchSwappableTokens();

    const pool = await getPoolByAddress(asset.address);
    if (!pool?.tokenA || !pool?.tokenB) return;
    const tokenA = pool.tokenA;
    const tokenB = pool.tokenB;
    const tokenAAddress = tokenA.address || (tokenA as any).token?.address;
    const tokenBAddress = tokenB.address || (tokenB as any).token?.address;
    if (!tokenAAddress || !tokenBAddress) return;

    const poolRatio = parseFloat(pool.aToBRatio || '0');
    const oracleA = parseFloat(pool.oracleAToBRatio || '0');
    const oracleB = parseFloat(pool.oracleBToARatio || '0');
    if (!Number.isFinite(poolRatio) || (!Number.isFinite(oracleA) && !Number.isFinite(oracleB))) return;

    let isAToB: boolean;
    let fromAmountWei: string;
    if (poolRatio > oracleA && Number.isFinite(oracleA)) {
      isAToB = true;
      fromAmountWei = computeArbFromAmountWei(pool, true, oracleA, getTokenBalanceWei(tokenAAddress));
    } else if (poolRatio < oracleA && Number.isFinite(oracleB)) {
      isAToB = false;
      fromAmountWei = computeArbFromAmountWei(pool, false, oracleB, getTokenBalanceWei(tokenBAddress));
    } else {
      fromAmountWei = '0';
      isAToB = poolRatio > (oracleA || 0);
    }

    const fromTokenAddr = isAToB ? tokenAAddress : tokenBAddress;
    // When align amount is 0 (e.g. missing oracle or no misalignment), prefill with user's balance.
    // Prefer activeTokens; fall back to pool's token balance (from getPoolByAddress).
    if (fromAmountWei === '0') {
      const balanceWei = getTokenBalanceWei(fromTokenAddr)
        || (isAToB ? (tokenA.balance || '0') : (tokenB.balance || '0'));
      fromAmountWei = balanceWei;
    }

    const fromDecimals = isAToB ? (tokenA.customDecimals ?? tokenA.decimals ?? 18) : (tokenB.customDecimals ?? tokenB.decimals ?? 18);
    const fromAmountHuman = fromAmountWei === '0' ? '0' : formatUnits(fromAmountWei, fromDecimals);

    const toTokenAddr = isAToB ? tokenBAddress : tokenAAddress;
    const updatedPairable = await fetchPairableTokens(fromTokenAddr);
    const matchingTo = updatedPairable.find((t) => t.address.toLowerCase() === toTokenAddr.toLowerCase());
    const matchingFrom = swappableTokens.find((t) => t.address.toLowerCase() === fromTokenAddr.toLowerCase());

    const preparedFromAsset: SwapToken = matchingFrom || {
      address: fromTokenAddr,
      _symbol: (isAToB ? tokenA : tokenB)._symbol || (isAToB ? tokenA : tokenB).symbol || '',
      symbol: (isAToB ? tokenA : tokenB)._symbol || (isAToB ? tokenA : tokenB).symbol || '',
      balance: getTokenBalanceWei(fromTokenAddr),
      poolBalance: (isAToB ? tokenA : tokenB).poolBalance || '0',
      decimals: fromDecimals,
    };
    const preparedToAsset: SwapToken = matchingTo || {
      address: toTokenAddr,
      _symbol: (isAToB ? tokenB : tokenA)._symbol || (isAToB ? tokenB : tokenA).symbol || '',
      symbol: (isAToB ? tokenB : tokenA)._symbol || (isAToB ? tokenB : tokenA).symbol || '',
      balance: getTokenBalanceWei(toTokenAddr),
      poolBalance: (isAToB ? tokenB : tokenA).poolBalance || '0',
      decimals: (isAToB ? tokenB : tokenA).customDecimals ?? (isAToB ? tokenB : tokenA).decimals ?? 18,
    };

    setSwapAsset(asset);
    setSwapMode('arb');
    setSwapFromToken(preparedFromAsset);
    setSwapToToken(preparedToAsset);
    setSwapInitialFromAmount(fromAmountHuman);
    setSwapModalOpen(true);
  }, [getPoolByAddress, refetchSwappableTokens, swappableTokens, fetchPairableTokens, getTokenBalanceWei, computeArbFromAmountWei]);

  // Handle opening swap modal
  const handleOpenSwap = useCallback(async (asset: EarningAsset, mode: 'buy' | 'sell') => {
    // Wait for swappable tokens to be loaded if needed
    if (swappableTokens.length === 0) {
      await refetchSwappableTokens();
    }

    // Check if this is a pool
    const isPool = (asset as any).isPool === true;
    
    // For pools, use tokenA and tokenB instead of the pool address
    let tokenA: any = null;
    let tokenB: any = null;
    if (isPool) {
      tokenA = (asset as any).tokenA;
      tokenB = (asset as any).tokenB;
      if (!tokenA || !tokenB) {
        console.error('Pool asset missing tokenA or tokenB');
        return;
      }
    }

    // Find USDST in swappable tokens
    let usdstToken = swappableTokens.find(t => t.address.toLowerCase() === usdstAddress.toLowerCase());

    // If USDST not found, wait a bit and try again, or create a basic one
    if (!usdstToken) {
      // Try fetching pairable tokens to refresh the list
      await refetchSwappableTokens();
      usdstToken = swappableTokens.find(t => t.address.toLowerCase() === usdstAddress.toLowerCase());

      if (!usdstToken) {
        // Create a basic USDST token as fallback
        usdstToken = {
          address: usdstAddress,
          _symbol: 'USDST',
          symbol: 'USDST',
          balance: usdstBalance || '0',
          poolBalance: '0',
          decimals: 18,
        };
      }
    }

    setSwapAsset(asset);
    setSwapMode(mode);

    // Prepare assets before opening modal
    let preparedFromAsset: SwapToken | undefined;
    let preparedToAsset: SwapToken | undefined;

    if (isPool) {
      // For pools:
      // Buy: tokenB (from) -> tokenA (to)  [e.g., USDST -> ETHST]
      // Sell: tokenA (from) -> tokenB (to)  [e.g., ETHST -> USDST]
      
      if (mode === 'buy') {
        // Buy: tokenB (from) -> tokenA (to)
        const tokenBAddress = tokenB.address || tokenB.token?.address;
        const tokenAAddress = tokenA.address || tokenA.token?.address;
        
        // Fetch pairable tokens for tokenB to get tokenA
        const updatedPairableTokens = await fetchPairableTokens(tokenBAddress);
        
        // Find tokenA in pairable tokens
        const matchingTokenA = updatedPairableTokens.find(t =>
          t.address.toLowerCase() === tokenAAddress.toLowerCase()
        );
        
        // Find tokenB in swappable tokens or create from pool data
        const matchingTokenB = swappableTokens.find(t =>
          t.address.toLowerCase() === tokenBAddress.toLowerCase()
        ) || {
          address: tokenBAddress,
          _symbol: tokenB._symbol || tokenB.symbol || tokenB.token?._symbol || tokenB.token?.symbol || 'TOKENB',
          symbol: tokenB._symbol || tokenB.symbol || tokenB.token?._symbol || tokenB.token?.symbol || 'TOKENB',
          balance: '0',
          poolBalance: tokenB.balance || tokenB.token?.balance || '0',
          decimals: tokenB.decimals || tokenB.token?.decimals || 18,
        };
        
        preparedFromAsset = matchingTokenB;
        preparedToAsset = matchingTokenA || {
          address: tokenAAddress,
          _symbol: tokenA._symbol || tokenA.symbol || tokenA.token?._symbol || tokenA.token?.symbol || 'TOKENA',
          symbol: tokenA._symbol || tokenA.symbol || tokenA.token?._symbol || tokenA.token?.symbol || 'TOKENA',
          balance: '0',
          poolBalance: tokenA.balance || tokenA.token?.balance || '0',
          decimals: tokenA.decimals || tokenA.token?.decimals || 18,
        };
      } else {
        // Sell: tokenA (from) -> tokenB (to)
        const tokenAAddress = tokenA.address || tokenA.token?.address;
        const tokenBAddress = tokenB.address || tokenB.token?.address;
        
        // Fetch pairable tokens for tokenA to get tokenB
        const updatedPairableTokens = await fetchPairableTokens(tokenAAddress);
        
        // Find tokenB in pairable tokens
        const matchingTokenB = updatedPairableTokens.find(t =>
          t.address.toLowerCase() === tokenBAddress.toLowerCase()
        );
        
        // Find tokenA in swappable tokens or create from pool data
        const matchingTokenA = swappableTokens.find(t =>
          t.address.toLowerCase() === tokenAAddress.toLowerCase()
        ) || {
          address: tokenAAddress,
          _symbol: tokenA._symbol || tokenA.symbol || tokenA.token?._symbol || tokenA.token?.symbol || 'TOKENA',
          symbol: tokenA._symbol || tokenA.symbol || tokenA.token?._symbol || tokenA.token?.symbol || 'TOKENA',
          balance: '0',
          poolBalance: tokenA.balance || tokenA.token?.balance || '0',
          decimals: tokenA.decimals || tokenA.token?.decimals || 18,
        };
        
        preparedFromAsset = matchingTokenA;
        preparedToAsset = matchingTokenB || {
          address: tokenBAddress,
          _symbol: tokenB._symbol || tokenB.symbol || tokenB.token?._symbol || tokenB.token?.symbol || 'TOKENB',
          symbol: tokenB._symbol || tokenB.symbol || tokenB.token?._symbol || tokenB.token?.symbol || 'TOKENB',
          balance: '0',
          poolBalance: tokenB.balance || tokenB.token?.balance || '0',
          decimals: tokenB.decimals || tokenB.token?.decimals || 18,
        };
      }
    } else {
      // For regular tokens, use the existing logic
      const swapToken = convertToSwapToken(asset);
      if (!swapToken) {
        console.error('Could not convert asset to SwapToken');
        return;
      }

      if (mode === 'buy') {
        // Buy: USDST (from) -> Asset (to)
        // Fetch pairable tokens for USDST first to ensure the asset is available
        const updatedPairableTokens = await fetchPairableTokens(usdstAddress);

        // Find the matching token in pairable tokens to ensure it has all required fields
        const matchingSwapToken = updatedPairableTokens.find(t =>
          t.address.toLowerCase() === asset.address.toLowerCase()
        ) || swapToken;

        // Prepare assets with explicit addresses and all required fields
        preparedFromAsset = {
          ...usdstToken,
          address: usdstAddress,
          balance: usdstToken.balance || usdstBalance || '0',
          symbol: 'USDST',
          _symbol: 'USDST',
        };
        preparedToAsset = {
          ...matchingSwapToken,
          address: asset.address,
          symbol: asset.symbol,
          _symbol: asset.symbol,
        };
      } else {
        // Sell: Asset (from) -> USDST (to)
        // Fetch pairable tokens for the asset first to ensure USDST is available
        const updatedPairableTokens = await fetchPairableTokens(asset.address);

        // Find USDST in pairable tokens
        const matchingUsdstToken = updatedPairableTokens.find(t =>
          t.address.toLowerCase() === usdstAddress.toLowerCase()
        ) || usdstToken;

        // Prepare assets with explicit addresses and all required fields
        preparedFromAsset = {
          ...swapToken,
          address: asset.address,
          symbol: asset.symbol,
          _symbol: asset.symbol,
        };
        preparedToAsset = {
          ...matchingUsdstToken,
          address: usdstAddress,
          balance: matchingUsdstToken.balance || usdstBalance || '0',
          symbol: 'USDST',
          _symbol: 'USDST',
        };
      }
    }

    if (!preparedFromAsset || !preparedToAsset) {
      console.error('Failed to prepare swap assets');
      return;
    }

    // Store tokens for FixedSwapWidget (don't use SwapContext state)
    setSwapFromToken(preparedFromAsset);
    setSwapToToken(preparedToAsset);

    // Open modal
    setSwapModalOpen(true);
  }, [convertToSwapToken, swappableTokens, setFromAsset, setToAsset, fetchPairableTokens, refetchSwappableTokens, usdstBalance]);

  // Fetch user tokens to get accurate balances
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  // Fetch all available tokens and pools for price tracking
  useEffect(() => {
    const fetchAllAssets = async () => {
      setLoadingAssets(true);
      try {
        // Fetch tokens with status == 2
        const tokensResponse = await api.get<any[]>('/tokens', {
          params: { status: 'eq.2' },
        });
        const tokens = Array.isArray(tokensResponse.data) ? tokensResponse.data : (tokensResponse.data?.tokens || []);

        // Fetch pools from /swap-pools endpoint
        const poolsResponse = await api.get<any[]>('/swap-pools');
        const pools = poolsResponse.data || [];

        // Create a map of user token balances from activeTokens
        const userBalances: Map<string, string> = new Map();
        activeTokens.forEach((token: any) => {
          const address = token.address || token.token?.address;
          const balance = token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';
          if (address) {
            userBalances.set(address.toLowerCase(), balance);
          }
        });

        // Transform tokens to match EarningAsset format
        // Filter out LP tokens - only keep active tokens (GOLDST, SILVST, ETHST, WBTCST, PAXGST, XAUtST, sUSDSST)
        const transformedTokens: EarningAsset[] = tokens
          .filter((token: any) => {
            if (!token.address || !(token._symbol || token.symbol)) return false;
            
            const symbol = token._symbol || token.symbol || token.token?._symbol || token.token?.symbol || '';
            
            // Exclude LP tokens (but allow sUSDSST/SUSDSST as it's an active token)
            const isLPToken =
              symbol.endsWith('-LP') ||
              symbol === 'SUSDST' ||
              symbol === 'MUSDST' ||
              token.description === 'Liquidity Provider Token' ||
              token.token?.description === 'Liquidity Provider Token';
            
            // Only include if it's not an LP token
            return !isLPToken;
          })
          .map((token: any) => {
            const symbol = token._symbol || token.symbol || token.token?._symbol || token.token?.symbol || 'UNKNOWN';
            const address = token.address || token.token?.address;

            // Use user balance if available, otherwise use token balance
            const userBalance = userBalances.get(address?.toLowerCase() || '');
            const balance = userBalance || token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';

            return {
              ...token,
              symbol,
              address,
              price: token.price || token.token?.price || '0',
              balance,
              value: token.value || '0',
              isPoolToken: false, // No LP tokens in the list
              isPool: false, // Regular token, not a pool
              collateralBalance: '0',
            };
          });

        // Transform pools - add pool entries (not LP tokens)
        const transformedPools: EarningAsset[] = pools.map((pool: any) => {
          // Calculate pool price from token balances (ratio)
          const tokenABalance = parseFloat(pool.tokenA?.balance || pool.tokenABalance || '0');
          const tokenBBalance = parseFloat(pool.tokenB?.balance || pool.tokenBBalance || '0');
          const poolPrice = tokenABalance > 0 ? (tokenBBalance / tokenABalance).toString() : '0';

          return {
            address: pool.address,
            symbol: pool.poolName || pool.poolSymbol || `${pool.tokenA?._symbol || 'A'}-${pool.tokenB?._symbol || 'B'}`,
            price: poolPrice,
            balance: '0',
            value: '0',
            isPoolToken: false,
            isPool: true, // This is a pool, not an LP token
            collateralBalance: '0',
            poolName: pool.poolName,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
          };
        });

        // Combine all assets: tokens and pools only (no LP tokens)
        const allAssets = [...transformedTokens, ...transformedPools];
        setAvailableAssets(allAssets);
      } catch (error) {
        console.error('Failed to fetch assets:', error);
        // Fallback to earning assets if available
        if (earningAssets.length > 0) {
          setAvailableAssets(earningAssets);
        }
      } finally {
        setLoadingAssets(false);
      }
    };

    fetchAllAssets();
  }, [activeTokens]);

  // Get filtered and sorted assets - only pools
  const filteredAssets = useMemo(() => {
    return availableAssets
      .filter((asset) => asset.address && asset.symbol && (asset as any).isPool === true)
      .sort((a, b) => {
        const valueA = parseFloat(a.value || '0');
        const valueB = parseFloat(b.value || '0');
        return valueB - valueA;
      });
  }, [availableAssets]);

  // Initialize widgets with default assets if not already set from localStorage
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current && filteredAssets.length > 0) {
      // Check if widgets are already configured (from localStorage or user selection)
      const hasConfiguredWidgets = widgets.some(w => w.assetAddress !== null);

      if (!hasConfiguredWidgets) {
        // Default pools: GOLDST-USDST, SILVST-USDST, ETHST-USDST, WBTCST-USDST
        const defaultPoolNames = ['GOLDST-USDST', 'SILVST-USDST', 'ETHST-USDST', 'WBTCST-USDST'];

        setWidgets((prev) => {
          const updated = [...prev];

          // Set all widgets with pools
          defaultPoolNames.forEach((poolName, index) => {
            // Try to find pool by poolName or symbol (case-insensitive)
            const pool = filteredAssets.find(a => {
              if ((a as any).isPool !== true) return false;
              const aPoolName = (a as any).poolName || '';
              const aSymbol = a.symbol || '';
              return aPoolName.toLowerCase() === poolName.toLowerCase() ||
                     aSymbol.toLowerCase() === poolName.toLowerCase() ||
                     aSymbol.toLowerCase().includes(poolName.toLowerCase().replace('-', ''));
            });
            if (pool) {
              updated[index] = {
                ...updated[index],
                assetAddress: pool.address,
              };
            }
          });

          hasInitialized.current = true;
          return updated;
        });
      } else {
        hasInitialized.current = true;
      }
    }
  }, [filteredAssets, widgets]);

  // Fetch price history for a token
  const fetchTokenPriceHistory = useCallback(
    async (assetAddress: string, duration: string, interval: Interval): Promise<OHLCData[]> => {
      try {
        const response = await api.get('/oracle/price-history/' + assetAddress, {
          params: { duration },
        });
        const priceHistory = response.data.data || [];
        if (priceHistory.length === 0) return [];

        // Convert price history entries to format expected by convertToOHLC
        const formattedHistory = priceHistory.map((entry: any) => {
          const timestamp = entry.blockTimestamp
            ? new Date(entry.blockTimestamp).getTime()
            : (entry.timestamp instanceof Date
              ? entry.timestamp.getTime()
              : new Date(entry.timestamp).getTime());
          return {
            timestamp,
            price: entry.price,
          };
        });
        const intervalMs = getIntervalMs(interval);
        return convertToOHLC(formattedHistory, intervalMs);
      } catch (error) {
        console.error(`Failed to fetch token price history for ${assetAddress}:`, error);
        return [];
      }
    },
    []
  );

  // Get interval in milliseconds
  const getIntervalMs = useCallback((interval: Interval): number => {
    switch (interval) {
      case '10s':
        return 10 * 1000;
      case '5m':
        return 5 * 60 * 1000;
      case '15m':
        return 15 * 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      case '4h':
        return 4 * 60 * 60 * 1000;
      case '1d':
        return 24 * 60 * 60 * 1000;
      default:
        return 5 * 60 * 1000;
    }
  }, []);

  // Fetch price history for a pool
  const fetchPoolPriceHistory = useCallback(
    async (poolAddress: string, duration: string, interval: Interval, tokenAAddress?: string, tokenBAddress?: string): Promise<OHLCData[]> => {
      try {
        const response = await api.get('/tokens/v2/pool-price-history/' + poolAddress, {
          params: { duration },
        });
        const priceHistory = response.data || [];
        const intervalMs = getIntervalMs(interval);

        // Convert pool balance history to OHLC (simplified - using balance as price)
        if (priceHistory.length === 0) return [];

        // Fetch token price histories for spot price calculation if addresses provided
        let tokenAPriceHistory: any[] = [];
        let tokenBPriceHistory: any[] = [];
        if (tokenAAddress && tokenBAddress) {
          try {
            const [tokenAResponse, tokenBResponse] = await Promise.all([
              api.get('/oracle/price-history/' + tokenAAddress, { params: { duration } }),
              api.get('/oracle/price-history/' + tokenBAddress, { params: { duration } }),
            ]);
            tokenAPriceHistory = tokenAResponse.data.data || [];
            tokenBPriceHistory = tokenBResponse.data.data || [];
          } catch (error) {
            console.warn('Failed to fetch token price histories for spot price:', error);
          }
        }

        // Create a map of spot prices by timestamp (rounded to interval)
        const spotPriceMap = new Map<number, number>();
        if (tokenAPriceHistory.length > 0 && tokenBPriceHistory.length > 0) {
          // Create maps of token prices by timestamp
          const tokenAPriceMap = new Map<number, number>();
          const tokenBPriceMap = new Map<number, number>();
          
          tokenAPriceHistory.forEach((entry: any) => {
            const timestamp = entry.blockTimestamp
              ? new Date(entry.blockTimestamp).getTime()
              : (entry.timestamp instanceof Date
                ? entry.timestamp.getTime()
                : new Date(entry.timestamp).getTime());
            const roundedTimestamp = Math.floor(timestamp / intervalMs) * intervalMs;
            const price = parseFloat(entry.price);
            const normalizedPrice = price > 1e10 ? price / 1e18 : price;
            tokenAPriceMap.set(roundedTimestamp, normalizedPrice);
          });
          
          tokenBPriceHistory.forEach((entry: any) => {
            const timestamp = entry.blockTimestamp
              ? new Date(entry.blockTimestamp).getTime()
              : (entry.timestamp instanceof Date
                ? entry.timestamp.getTime()
                : new Date(entry.timestamp).getTime());
            const roundedTimestamp = Math.floor(timestamp / intervalMs) * intervalMs;
            const price = parseFloat(entry.price);
            const normalizedPrice = price > 1e10 ? price / 1e18 : price;
            tokenBPriceMap.set(roundedTimestamp, normalizedPrice);
          });
          
          // Calculate spot price for each timestamp where both prices exist.
          // Use exact matches first, then fill from nearest-neighbor so pool timestamps (e.g. 2h for 1m) align with oracle data.
          const allTimestamps = new Set([...tokenAPriceMap.keys(), ...tokenBPriceMap.keys()]);
          allTimestamps.forEach((ts) => {
            const tokenAPrice = tokenAPriceMap.get(ts);
            const tokenBPrice = tokenBPriceMap.get(ts);
            if (tokenAPrice && tokenBPrice && tokenBPrice > 0) {
              spotPriceMap.set(ts, tokenAPrice / tokenBPrice);
            }
          });
          // For each pool timestamp we'll look up exact or nearest via getSpotPriceAt.
          // Also seed spotPriceMap at pool timestamps by nearest A/B when backend uses different intervals (e.g. 1m = 2h).
          const poolTimestamps = priceHistory.map((p: { timestamp: number }) => Math.floor(p.timestamp / intervalMs) * intervalMs);
          const poolTsSet = new Set(poolTimestamps);
          poolTsSet.forEach((ts) => {
            if (spotPriceMap.has(ts)) return;
            const aKeys = Array.from(tokenAPriceMap.keys()).sort((a, b) => Math.abs(a - ts) - Math.abs(b - ts));
            const bKeys = Array.from(tokenBPriceMap.keys()).sort((a, b) => Math.abs(a - ts) - Math.abs(b - ts));
            const maxDiff = intervalMs * 4;
            const a = aKeys[0] != null && Math.abs(aKeys[0] - ts) <= maxDiff ? tokenAPriceMap.get(aKeys[0]) : undefined;
            const b = bKeys[0] != null && Math.abs(bKeys[0] - ts) <= maxDiff ? tokenBPriceMap.get(bKeys[0]) : undefined;
            if (a != null && b != null && b > 0) spotPriceMap.set(ts, a / b);
          });
        }

        // Helper: get spot price at timestamp, or nearest available (for alignment when pool/oracle use different intervals, e.g. 1m)
        const getSpotPriceAt = (t: number): number | undefined => {
          const rounded = Math.floor(t / intervalMs) * intervalMs;
          const exact = spotPriceMap.get(rounded);
          if (exact !== undefined) return exact;
          const keys = Array.from(spotPriceMap.keys());
          if (keys.length === 0) return undefined;
          const maxDiff = intervalMs * 3; // allow up to 3 intervals away
          let best: number | undefined;
          let bestDiff = Infinity;
          for (const k of keys) {
            const d = Math.abs(k - rounded);
            if (d <= maxDiff && d < bestDiff) {
              bestDiff = d;
              best = spotPriceMap.get(k);
            }
          }
          return best;
        };

        const ohlcData: OHLCData[] = [];
        priceHistory.forEach((point: { timestamp: number; balance: number }, index: number) => {
          const price = point.balance;
          const open = index > 0 ? ohlcData[index - 1].close : price;
          const spotPrice = getSpotPriceAt(point.timestamp);
          
          ohlcData.push({
            timestamp: point.timestamp,
            open,
            high: price,
            low: price,
            close: price,
            spotPrice,
          });
        });

        return ohlcData;
      } catch (error) {
        console.error(`Failed to fetch pool price history for ${poolAddress}:`, error);
        return [];
      }
    },
    [getIntervalMs]
  );

  // Fetch current price for a single asset (for polling)
  const fetchCurrentPrice = useCallback(async (widget: WidgetConfig): Promise<number | null> => {
    if (!widget.assetAddress) return null;

    const asset = filteredAssets.find((a) => a.address === widget.assetAddress);
    if (!asset) return null;

    const isPool = (asset as any).isPool === true;

    try {
      if (isPool) {
        // For pools, try bToARatio first, then calculate from balances
        const response = await api.get(`/swap-pools/${widget.assetAddress}`);
        const pool = response.data;

        // Try bToARatio first (could be string or number)
        const aToBRatioStr = pool.aToBRatio?.toString() || '0';
        const aToBRatio = parseFloat(aToBRatioStr);
        if (aToBRatio > 0 && !isNaN(aToBRatio)) {
          return aToBRatio;
        }

        // Fallback to calculating from balances (same logic as initial pool loading)
        // Try multiple possible locations for balances
        const tokenABalance = parseFloat(
          pool.tokenA?.balance ||
          pool.tokenABalance ||
          pool.tokenA?.tokenABalance ||
          '0'
        );
        const tokenBBalance = parseFloat(
          pool.tokenB?.balance ||
          pool.tokenBBalance ||
          pool.tokenB?.tokenBBalance ||
          '0'
        );

        if (tokenABalance > 0 && !isNaN(tokenABalance) && !isNaN(tokenBBalance)) {
          const calculatedPrice = tokenBBalance / tokenABalance;
          if (calculatedPrice > 0 && !isNaN(calculatedPrice)) {
            return calculatedPrice;
          }
        }

        console.warn(`Failed to get pool price for ${widget.assetAddress}:`, {
          bToARatio: pool.bToARatio,
          tokenABalance: pool.tokenA?.balance || pool.tokenABalance,
          tokenBBalance: pool.tokenB?.balance || pool.tokenBBalance,
          pool: pool
        });
        return null;
      } else {
        // For tokens, fetch from oracle price endpoint
        const response = await api.get('/oracle/price', {
          params: { asset: widget.assetAddress },
        });
        const priceEntry = response.data;
        if (priceEntry && priceEntry.price) {
          const price = parseFloat(priceEntry.price);
          return price > 1e10 ? price / 1e18 : price;
        }
        return null;
      }
    } catch (error) {
      console.error(`Failed to fetch current price for ${widget.assetAddress}:`, error);
      return null;
    }
  }, [filteredAssets]);

  // Fetch data for a single widget
  const fetchWidgetData = useCallback(async (widget: WidgetConfig, appendNewPrice = false) => {
    if (!widget.assetAddress) return;

        const asset = filteredAssets.find((a) => a.address === widget.assetAddress);
        if (!asset) return;

        // Check if this is a pool (not an LP token)
        const isPool = (asset as any).isPool === true;
    // Include timeRange and interval in dataKey so different configs are cached separately
    const dataKey = `${widget.id}-${widget.assetAddress}-${widget.timeRange}-${widget.interval}`;

    // If appending new price, don't set loading state
    if (!appendNewPrice) {
      // Set loading state
      setAssetData((prev) => {
        const updated = new Map(prev);
        const existing = prev.get(dataKey);
        updated.set(dataKey, {
          asset,
          data: existing?.data || [],
          loading: true,
          currentPrice: existing?.currentPrice || (() => {
            const price = parseFloat(asset.price || '0');
            return price > 1e10 ? price / 1e18 : price;
          })(),
          change24h: existing?.change24h || 0,
          changePercent24h: existing?.changePercent24h || 0,
        });
        return updated;
      });
    }

    try {
      // For pools, get tokenA and tokenB addresses for spot price calculation
      let tokenAAddress: string | undefined;
      let tokenBAddress: string | undefined;
      if (isPool) {
        const tokenA = (asset as any).tokenA;
        const tokenB = (asset as any).tokenB;
        tokenAAddress = tokenA?.address || tokenA?.token?.address;
        tokenBAddress = tokenB?.address || tokenB?.token?.address;
      }
      
      const ohlcData = isPool
        ? await fetchPoolPriceHistory(widget.assetAddress, widget.timeRange, widget.interval, tokenAAddress, tokenBAddress)
        : await fetchTokenPriceHistory(widget.assetAddress, widget.timeRange, widget.interval);

      // If appending, merge with existing data
      let finalData = ohlcData;
      if (appendNewPrice) {
        setAssetData((prev) => {
          const existing = prev.get(dataKey);
          if (existing && existing.data.length > 0) {
            // Get the last existing data point
            const lastExisting = existing.data[existing.data.length - 1];
            // Get the first new data point
            const firstNew = ohlcData[0];

            // If new data overlaps with existing, replace overlapping points
            // Otherwise, append new points that are after the last existing point
            const existingLastTimestamp = lastExisting.timestamp;
            const newDataAfterExisting = ohlcData.filter(d => d.timestamp > existingLastTimestamp);

            // Keep existing data up to the first new point, then add new data
            const existingDataBeforeNew = existing.data.filter(d => {
              if (newDataAfterExisting.length === 0) return true;
              return d.timestamp < newDataAfterExisting[0].timestamp;
            });

            finalData = [...existingDataBeforeNew, ...newDataAfterExisting];
          } else {
            finalData = ohlcData;
          }
          return prev;
        });
      }

      // Calculate change
      let change24h = 0;
      let changePercent24h = 0;
      if (finalData.length >= 2) {
        const current = finalData[finalData.length - 1];
        const previous = finalData[0];
        change24h = current.close - previous.close;
        changePercent24h = previous.close > 0 ? (change24h / previous.close) * 100 : 0;
      }

      setAssetData((prev) => {
        const updated = new Map(prev);
        updated.set(dataKey, {
          asset,
          data: finalData,
          loading: false,
          currentPrice: finalData.length > 0 ? finalData[finalData.length - 1].close : parseFloat(asset.price || '0') / 1e18,
          change24h,
          changePercent24h,
        });
        return updated;
      });
    } catch (error) {
      if (!appendNewPrice) {
        setAssetData((prev) => {
          const updated = new Map(prev);
          updated.set(dataKey, {
            asset,
            data: [],
            loading: false,
            error: 'Failed to load data',
            currentPrice: (() => {
              const price = parseFloat(asset.price || '0');
              return price > 1e10 ? price / 1e18 : price;
            })(),
            change24h: 0,
            changePercent24h: 0,
          });
          return updated;
        });
      }
    }
  }, [filteredAssets, fetchTokenPriceHistory, fetchPoolPriceHistory]);

  // Track previous widget configs to only fetch changed widgets
  const prevWidgetsRef = useRef<Map<string, string>>(new Map());

  // Fetch data when widgets change - only for changed widgets
  useEffect(() => {
    if (filteredAssets.length === 0) return;

    const currentWidgetKeys = new Map<string, string>();

    widgets.forEach((widget) => {
      const key = `${widget.id}-${widget.assetAddress}-${widget.timeRange}-${widget.interval}`;
      currentWidgetKeys.set(widget.id, key);

      const prevKey = prevWidgetsRef.current.get(widget.id);

      // Only fetch if widget config changed or if it's a new widget with an asset
      if (key !== prevKey && widget.assetAddress) {
        fetchWidgetData(widget);
      }
    });

    // Update ref for next comparison
    prevWidgetsRef.current = currentWidgetKeys;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, filteredAssets.length]);

  // Poll for current prices every 5 seconds
  useEffect(() => {
    if (filteredAssets.length === 0) return;

    const pollInterval = setInterval(async () => {
      // Poll each widget that has an asset
      for (const widget of widgets) {
        if (!widget.assetAddress) continue;

        const currentPrice = await fetchCurrentPrice(widget);
        if (currentPrice === null) continue;

        const dataKey = `${widget.id}-${widget.assetAddress}-${widget.timeRange}-${widget.interval}`;
        setAssetData((prev) => {
          const existing = prev.get(dataKey);
          if (!existing || existing.data.length === 0) return prev;

          const now = Date.now();
          const lastDataPoint = existing.data[existing.data.length - 1];

          // Only append if the new price is different or enough time has passed
          // Use the interval to determine if we should add a new point
          const intervalMs = getIntervalMs(widget.interval);
          const timeSinceLastPoint = now - lastDataPoint.timestamp;

          // If enough time has passed or price changed significantly, append new point
          if (timeSinceLastPoint >= intervalMs || Math.abs(currentPrice - lastDataPoint.close) / lastDataPoint.close > 0.001) {
            const updated = new Map(prev);
            const newDataPoint: OHLCData = {
              timestamp: now,
              open: lastDataPoint.close,
              high: Math.max(lastDataPoint.close, currentPrice),
              low: Math.min(lastDataPoint.close, currentPrice),
              close: currentPrice,
            };

            // Append new point
            const updatedData = [...existing.data, newDataPoint];

            // Calculate change from first point
            let change24h = 0;
            let changePercent24h = 0;
            if (updatedData.length >= 2) {
              const current = updatedData[updatedData.length - 1];
              const previous = updatedData[0];
              change24h = current.close - previous.close;
              changePercent24h = previous.close > 0 ? (change24h / previous.close) * 100 : 0;
            }

            updated.set(dataKey, {
              ...existing,
              data: updatedData,
              currentPrice,
              change24h,
              changePercent24h,
            });
            return updated;
          }

          return prev;
        });
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [widgets, filteredAssets.length, fetchCurrentPrice, getIntervalMs]);

  // Update widget configuration and save to localStorage
  const updateWidget = (widgetId: string, updates: Partial<WidgetConfig>) => {
    setWidgets((prev) => {
      const updated = prev.map((w) => (w.id === widgetId ? { ...w, ...updates } : w));
      // Save to localStorage
      try {
        localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(updated));
      } catch (error) {
        console.error('Failed to save widgets to localStorage:', error);
      }
      return updated;
    });
  };

  // Save widgets to localStorage whenever they change (for other updates like timeRange, interval, chartType)
  useEffect(() => {
    if (hasInitialized.current) {
      try {
        localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets));
      } catch (error) {
        console.error('Failed to save widgets to localStorage:', error);
      }
    }
  }, [widgets]);

  // Memoize hover handlers per widget to prevent unnecessary rerenders
  const hoverHandlersRef = useRef<Map<string, (hoverData: any) => void>>(new Map());

  const getHoverHandler = useCallback((widgetId: string) => {
    if (!hoverHandlersRef.current.has(widgetId)) {
      hoverHandlersRef.current.set(widgetId, (hoverData: any) => {
        // Update ref immediately (doesn't trigger chart rerender)
        if (hoverData) {
          hoveredDataByWidgetRef.current.set(widgetId, hoverData);
        } else {
          hoveredDataByWidgetRef.current.delete(widgetId);
        }
        // Only update the text component, not the chart - update immediately for responsiveness
        setHoverUpdateKey((prev) => prev + 1);
      });
    }
    return hoverHandlersRef.current.get(widgetId)!;
  }, []);

  // Render a single chart widget

  // Drag and drop handlers
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, widgetId: string) => {
    setDraggedWidgetId(widgetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', widgetId);
  };

  const handleDragOver = (e: React.DragEvent, widgetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedWidgetId && draggedWidgetId !== widgetId) {
      setDragOverWidgetId(widgetId);
    }
  };

  const handleDragLeave = () => {
    setDragOverWidgetId(null);
  };

  const handleDrop = (e: React.DragEvent, targetWidgetId: string) => {
    e.preventDefault();
    if (!draggedWidgetId || draggedWidgetId === targetWidgetId) {
      setDraggedWidgetId(null);
      setDragOverWidgetId(null);
      return;
    }

    const draggedIndex = widgets.findIndex(w => w.id === draggedWidgetId);
    const targetIndex = widgets.findIndex(w => w.id === targetWidgetId);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedWidgetId(null);
      setDragOverWidgetId(null);
      return;
    }

    const newWidgets = [...widgets];
    const [removed] = newWidgets.splice(draggedIndex, 1);
    newWidgets.splice(targetIndex, 0, removed);

    setWidgets(newWidgets);
    try {
      localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(newWidgets));
    } catch (error) {
      console.error('Failed to save widgets to localStorage:', error);
    }

    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  };

  const handleDragEnd = () => {
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  };

  const renderChartWidget = (widget: WidgetConfig) => {
          const dataKey = widget.assetAddress ? `${widget.id}-${widget.assetAddress}-${widget.timeRange}-${widget.interval}` : null;
          const data = dataKey ? assetData.get(dataKey) : null;
          const asset = widget.assetAddress
            ? data?.asset || filteredAssets.find((a) => a.address === widget.assetAddress)
            : null;

          const isLoading = data?.loading || false;
          const price = data?.currentPrice || (asset ? parseFloat(asset.price || '0') / 1e18 : 0);
          const change = data?.change24h || 0;
          const changePercent = data?.changePercent24h || 0;
          const isPositive = change >= 0;
          const ohlcData = data?.data || [];
          const isPool = asset ? (asset as any).isPool === true : false;
          // Read from ref to avoid triggering chart rerenders
          const hoveredData = hoveredDataByWidgetRef.current.get(widget.id);
          // Use hoverUpdateKey to force text component to update when hover changes
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _hoverUpdateKey = hoverUpdateKey;

    return (
      <div
        className={`w-full ${dragOverWidgetId === widget.id ? 'ring-2 ring-primary rounded-lg' : ''}`}
        onDragOver={(e) => handleDragOver(e, widget.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, widget.id)}
      >
      <Card
        key={widget.id}
        className={`w-full relative ${draggedWidgetId === widget.id ? 'opacity-50' : ''}`}
      >
        <CardHeader className="pb-2">
          {/* Top row: Drag handle, Asset selector, Buy/Sell buttons, Chart type buttons, Price/Change (with overflow) */}
          <div className="flex items-center gap-2 mb-2">
            <div
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
              draggable
              onDragStart={(e) => {
                handleDragStart(e, widget.id);
                e.stopPropagation();
              }}
              onDragEnd={handleDragEnd}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select
              value={widget.assetAddress || 'none'}
              onValueChange={(value) =>
                updateWidget(widget.id, { assetAddress: value === 'none' ? null : value })
              }
            >
              <SelectTrigger className="h-8 text-sm w-64">
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Select asset...</SelectItem>
                    {filteredAssets.map((a) => {
                      const isPool = (a as any).isPool === true;
                      const isLPToken = a.isPoolToken && !isPool;
                      const label = a.symbol;
                      return (
                        <SelectItem key={a.address} value={a.address}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
            </Select>
            {/* Buy/Sell buttons */}
            {asset && (() => {
              const isPool = (asset as any).isPool === true;
              let buyEnabled = false;
              let sellEnabled = false;
              
              if (isPool) {
                // For pools:
                // Buy: needs tokenB balance (e.g., USDST for ETHST-USDST pool)
                // Sell: needs tokenA balance (e.g., ETHST for ETHST-USDST pool)
                const tokenA = (asset as any).tokenA;
                const tokenB = (asset as any).tokenB;
                const tokenAAddress = tokenA?.address || tokenA?.token?.address;
                const tokenBAddress = tokenB?.address || tokenB?.token?.address;
                
                buyEnabled = hasTokenBalance(tokenBAddress);
                sellEnabled = hasTokenBalance(tokenAAddress);
              } else {
                // For regular tokens:
                // Buy: needs USDST balance
                // Sell: needs asset balance
                buyEnabled = hasUsdstBalance;
                sellEnabled = hasAssetBalance(asset);
              }
              
              return (
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleOpenSwap(asset, 'buy')}
                    disabled={!buyEnabled}
                  >
                    <span className={buyEnabled ? 'text-green-500' : 'text-muted-foreground'}>Buy</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleOpenSwap(asset, 'sell')}
                    disabled={!sellEnabled}
                  >
                    <span className={sellEnabled ? 'text-red-500' : 'text-muted-foreground'}>Sell</span>
                  </Button>
                </div>
              );
            })()}
            {/* ARB button (pools only) - between Sell and spot price toggle */}
            {isPool && (widget.showSpotPrice !== false) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs shrink-0"
                onClick={() => handleOpenArb(asset)}
                aria-label="Arbitrage"
              >
                <span className="text-amber-500">ARB</span>
              </Button>
            )}
            {/* Spot price toggle (pools only) */}
            {isPool && ohlcData.some(d => d.spotPrice !== undefined) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={widget.showSpotPrice !== false ? 'secondary' : 'ghost'}
                    className="h-7 px-2 shrink-0"
                    onClick={() => updateWidget(widget.id, { showSpotPrice: widget.showSpotPrice === false })}
                    aria-label={widget.showSpotPrice !== false ? 'Hide Spot Price' : 'Show Spot Price'}
                  >
                    <CircleDollarSign className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{widget.showSpotPrice !== false ? 'Hide Spot Price' : 'Show Spot Price'}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
            </CardHeader>
            <CardContent className="pt-2">
              {widget.assetAddress ? (
                <CandlestickChart
                  key={`${widget.id}-${widget.chartType}-${widget.showSpotPrice !== false}`}
                  data={ohlcData}
                  loading={isLoading}
                  height={250}
                  showVolume={false}
                  chartType={widget.chartType}
                  onHoverDataChange={getHoverHandler(widget.id)}
                  timeRange={widget.timeRange}
                  showSpotPrice={isPool && ohlcData.some(d => d.spotPrice !== undefined) && (widget.showSpotPrice !== false)}
                  isDollarValued={isPool && (asset as any)?.tokenB?.address && (asset as any).tokenB.address === usdstAddress}
                />
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
              Select an asset to view price chart
            </div>
          )}
          {/* Bottom row: Range and Interval selectors */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Range:</span>
            <Select
              value={widget.timeRange}
              onValueChange={(value) => {
                const newTimeRange = value as TimeRange;
                const defaultInterval = DEFAULT_INTERVALS[newTimeRange];
                updateWidget(widget.id, {
                  timeRange: newTimeRange,
                  interval: defaultInterval,
                });
              }}
            >
                <SelectTrigger className="h-7 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((range) => (
                    <SelectItem key={range} value={range}>
                      {range.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Interval:</span>
              <Select
                value={widget.interval}
                onValueChange={(value) => updateWidget(widget.id, { interval: value as Interval })}
              >
                <SelectTrigger className="h-7 text-xs w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((interval) => (
                    <SelectItem key={interval} value={interval}>
                      {interval}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Trading Desk" />
        <main className="p-4 md:p-6 pb-24 md:pb-6">
          {loadingAssets ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Loading assets...</span>
            </div>
          ) : filteredAssets.length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center h-64 text-muted-foreground">
                No assets available
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {widgets.map((widget) => renderChartWidget(widget))}
            </div>
          )}
        </main>
      </div>
      <MobileBottomNav />

      {/* Swap Modal */}
      {(() => {
        const closeSwapModal = () => {
          setSwapModalOpen(false);
          setSwapAsset(null);
          setSwapMode(null);
          setSwapFromToken(null);
          setSwapToToken(null);
          setSwapInitialFromAmount(null);
        };

        return (
          <Dialog
            open={swapModalOpen}
            onOpenChange={(open) => {
              if (!open) closeSwapModal();
              else setSwapModalOpen(true);
            }}
          >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {swapMode === 'arb' ? 'Arbitrage' : swapMode === 'buy' ? 'Buy' : 'Sell'} {swapMode === 'arb' ? (swapAsset?.symbol ?? '') : (swapAsset?.symbol || 'Asset')}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {swapModalOpen && swapFromToken && swapToToken && (
              <FixedSwapWidget
                fromAsset={swapFromToken}
                toAsset={swapToToken}
                initialFromAmount={swapMode === 'arb' ? (swapInitialFromAmount ?? undefined) : undefined}
                onSwapSuccess={closeSwapModal}
              />
            )}
          </div>
        </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
};

export default PriceTracking;

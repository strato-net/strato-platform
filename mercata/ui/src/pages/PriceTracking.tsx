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
import { Loader2, TrendingUp, TrendingDown, Search, BarChart3, LineChart as LineChartIcon, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EarningAsset } from '@mercata/shared-types';
import { format } from 'date-fns';
import FixedSwapWidget from '@/components/swap/FixedSwapWidget';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress } from '@/lib/constants';
import { SwapToken } from '@/interface';

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
  const { setFromAsset, setToAsset, swappableTokens, refetchSwappableTokens, fetchPairableTokens, getPoolByTokenPair } = useSwapContext();
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapMode, setSwapMode] = useState<'buy' | 'sell' | null>(null);
  const [swapAsset, setSwapAsset] = useState<EarningAsset | null>(null);
  const [swapFromToken, setSwapFromToken] = useState<SwapToken | null>(null);
  const [swapToToken, setSwapToToken] = useState<SwapToken | null>(null);
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
  // For tokens/LP tokens, check the balance from activeTokens
  const hasAssetBalance = useCallback((asset: EarningAsset): boolean => {
    // Pools can't be sold directly
    if ((asset as any).isPool === true) {
      return false;
    }
    if (!asset.address) return false;

    // Check activeTokens for user balance
    const token = activeTokens.find((t: any) => {
      const address = t.address || t.token?.address;
      return address?.toLowerCase() === asset.address.toLowerCase();
    });

    if (token) {
      const balance = token.balance || token.token?.balance || token.balances?.[0]?.balance || '0';
      const balanceBigInt = BigInt(balance);
      return balanceBigInt > 0n;
    }

    // Fallback to asset.balance if not found in activeTokens
    if (asset.balance) {
      const balanceBigInt = BigInt(asset.balance);
      return balanceBigInt > 0n;
    }

    return false;
  }, [activeTokens]);

  // Check if user has USDST balance
  const hasUsdstBalance = useMemo(() => {
    if (!usdstBalance) return false;
    // Balance is in wei, so we need to check if it's > 0
    const balance = BigInt(usdstBalance || '0');
    return balance > 0n;
  }, [usdstBalance]);

  // Handle opening swap modal
  const handleOpenSwap = useCallback(async (asset: EarningAsset, mode: 'buy' | 'sell') => {
    // Wait for swappable tokens to be loaded if needed
    if (swappableTokens.length === 0) {
      await refetchSwappableTokens();
    }

    const swapToken = convertToSwapToken(asset);
    if (!swapToken) {
      console.error('Could not convert asset to SwapToken');
      return;
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
        const transformedTokens: EarningAsset[] = tokens
          .filter((token: any) => token.address && (token._symbol || token.symbol)) // Filter out invalid tokens
          .map((token: any) => {
            const symbol = token._symbol || token.symbol || token.token?._symbol || token.token?.symbol || 'UNKNOWN';
            const address = token.address || token.token?.address;
            const isLPToken =
              symbol.endsWith('-LP') ||
              symbol === 'SUSDST' ||
              symbol === 'MUSDST' ||
              symbol === 'SUSDSST' ||
              token.description === 'Liquidity Provider Token' ||
              token.token?.description === 'Liquidity Provider Token';

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
              isPoolToken: isLPToken,
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

        // Transform LP tokens from pools
        const transformedLPTokens: EarningAsset[] = pools
          .filter((pool: any) => pool.lpToken?.address)
          .map((pool: any) => {
            const lpToken = pool.lpToken;
            // Use user balance if available, otherwise use LP token balance
            const userBalance = userBalances.get(lpToken.address?.toLowerCase() || '');
            const balance = userBalance || lpToken.balance || '0';

            return {
              address: lpToken.address,
              symbol: lpToken._symbol || lpToken.symbol || `${pool.poolName || 'Pool'}-LP`,
              price: lpToken.price || '0',
              balance,
              value: lpToken.value || '0',
              isPoolToken: true, // This is an LP token
              isPool: false,
              collateralBalance: '0',
              poolAddress: pool.address, // Reference to parent pool
            };
          });

        // Combine all assets: tokens, pools, and LP tokens
        const allAssets = [...transformedTokens, ...transformedPools, ...transformedLPTokens];
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

  // Get filtered and sorted assets
  const filteredAssets = useMemo(() => {
    return availableAssets
      .filter((asset) => asset.address && asset.symbol)
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
        // Default tokens: GOLDST, SILVST, ETHST, WBTCST
        const defaultTokenSymbols = ['GOLDST', 'SILVST', 'ETHST', 'WBTCST'];
        // Default pools: GOLDST-USDST, SILVST-USDST, ETHST-USDST, WBTCST-USDST
        const defaultPoolNames = ['GOLDST-USDST', 'SILVST-USDST', 'ETHST-USDST', 'WBTCST-USDST'];

        setWidgets((prev) => {
          const updated = [...prev];

          // Set top row (0-3) with tokens
          defaultTokenSymbols.forEach((symbol, index) => {
            const asset = filteredAssets.find(a =>
              a.symbol === symbol && !(a as any).isPool && !a.isPoolToken
            );
            if (asset) {
              updated[index] = {
                ...updated[index],
                assetAddress: asset.address,
              };
            }
          });

          // Set bottom row (4-7) with pools
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
              updated[index + 4] = {
                ...updated[index + 4],
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

  // Fetch price history for a pool
  const fetchPoolPriceHistory = useCallback(
    async (poolAddress: string, duration: string, interval: Interval): Promise<OHLCData[]> => {
      try {
        const response = await api.get('/tokens/v2/pool-price-history/' + poolAddress, {
          params: { duration },
        });
        const priceHistory = response.data || [];
        const intervalMs = getIntervalMs(interval);

        // Convert pool balance history to OHLC (simplified - using balance as price)
        if (priceHistory.length === 0) return [];

        const ohlcData: OHLCData[] = [];
        priceHistory.forEach((point: { timestamp: number; balance: number }, index: number) => {
          const price = point.balance;
          const open = index > 0 ? ohlcData[index - 1].close : price;
          ohlcData.push({
            timestamp: point.timestamp,
            open,
            high: price,
            low: price,
            close: price,
          });
        });

        return ohlcData;
      } catch (error) {
        console.error(`Failed to fetch pool price history for ${poolAddress}:`, error);
        return [];
      }
    },
    []
  );

  // Get interval in milliseconds
  const getIntervalMs = (interval: Interval): number => {
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
  };

  // Fetch data for a single widget
  const fetchWidgetData = useCallback(async (widget: WidgetConfig) => {
    if (!widget.assetAddress) return;

        const asset = filteredAssets.find((a) => a.address === widget.assetAddress);
        if (!asset) return;

        // Check if this is a pool (not an LP token)
        const isPool = (asset as any).isPool === true;
    // Include timeRange and interval in dataKey so different configs are cached separately
    const dataKey = `${widget.id}-${widget.assetAddress}-${widget.timeRange}-${widget.interval}`;

    // Set loading state
    setAssetData((prev) => {
      const updated = new Map(prev);
      updated.set(dataKey, {
        asset,
        data: [],
        loading: true,
        currentPrice: (() => {
          const price = parseFloat(asset.price || '0');
          return price > 1e10 ? price / 1e18 : price;
        })(),
        change24h: 0,
        changePercent24h: 0,
      });
      return updated;
    });

    try {
      const ohlcData = isPool
        ? await fetchPoolPriceHistory(widget.assetAddress, widget.timeRange, widget.interval)
        : await fetchTokenPriceHistory(widget.assetAddress, widget.timeRange, widget.interval);

      // Calculate change
      let change24h = 0;
      let changePercent24h = 0;
      if (ohlcData.length >= 2) {
        const current = ohlcData[ohlcData.length - 1];
        const previous = ohlcData[0];
        change24h = current.close - previous.close;
        changePercent24h = previous.close > 0 ? (change24h / previous.close) * 100 : 0;
      }

      setAssetData((prev) => {
        const updated = new Map(prev);
        updated.set(dataKey, {
          asset,
          data: ohlcData,
          loading: false,
          currentPrice: ohlcData.length > 0 ? ohlcData[ohlcData.length - 1].close : parseFloat(asset.price || '0') / 1e18,
          change24h,
          changePercent24h,
        });
        return updated;
      });
    } catch (error) {
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
                      let label = a.symbol;
                      if (isPool) {
                        label += ' (Pool)';
                      } else if (isLPToken) {
                        label += ' (LP Token)';
                      }
                      return (
                        <SelectItem key={a.address} value={a.address}>
                          {label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
            </Select>
            {/* Buy/Sell buttons */}
            {asset && (
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleOpenSwap(asset, 'buy')}
                  disabled={!hasUsdstBalance}
                >
                  <span className={hasUsdstBalance ? 'text-green-500' : 'text-muted-foreground'}>Buy</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleOpenSwap(asset, 'sell')}
                  disabled={!hasAssetBalance(asset)}
                >
                  <span className={hasAssetBalance(asset) ? 'text-red-500' : 'text-muted-foreground'}>Sell</span>
                </Button>
              </div>
            )}
            {/* Chart type toggle */}
            <ToggleGroup
              type="single"
              value={widget.chartType}
              onValueChange={(value) => {
                if (value) updateWidget(widget.id, { chartType: value as ChartType });
              }}
              className="h-7 shrink-0"
            >
              <ToggleGroupItem value="line" aria-label="Line chart" size="sm" className="h-7 px-2">
                <LineChartIcon className="h-3.5 w-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="candlestick" aria-label="Candlestick chart" size="sm" className="h-7 px-2">
                <BarChart3 className="h-3.5 w-3.5" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
            </CardHeader>
            <CardContent className="pt-2">
              {widget.assetAddress ? (
                <CandlestickChart
              data={ohlcData}
              loading={isLoading}
              height={250}
              showVolume={false}
              chartType={widget.chartType}
              onHoverDataChange={getHoverHandler(widget.id)}
              timeRange={widget.timeRange}
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
      <Dialog open={swapModalOpen} onOpenChange={(open) => {
        setSwapModalOpen(open);
        // Clear swap state when modal closes
        if (!open) {
          setSwapAsset(null);
          setSwapMode(null);
          setSwapFromToken(null);
          setSwapToToken(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {swapMode === 'buy' ? 'Buy' : 'Sell'} {swapAsset?.symbol || 'Asset'}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {swapModalOpen && swapFromToken && swapToToken && (
              <FixedSwapWidget
                fromAsset={swapFromToken}
                toAsset={swapToToken}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PriceTracking;

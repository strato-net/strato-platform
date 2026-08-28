import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { useTokenContext } from '@/context/TokenContext';
import { Token, SwapHistoryEntry } from '@/interface';
import { formatUnits } from 'ethers';
import { api } from '@/lib/axios';
import ConsolidatedPriceChart from '@/components/charts/ConsolidatedPriceChart';
import CopyButton from '@/components/ui/copy';
import { addCommasToInput, formatWeiAmount, formatHash } from '@/utils/numberUtils';
import { buildFundBuyPath, fetchBridgeBuyableAddresses, normBridgeAddr } from '@/lib/bridgeLinks';

const RECENT_SWAPS_LIMIT = 10;

type PricePoint = {
  date: string;
  price: string;
  timestamp?: number;
};

type SwapPricePoint = {
  date: string;
  price: string;
  timestamp: number;
  poolAddress?: string;
  volume?: string;
};

interface PriceHistoryApiEntry {
  id: string;
  timestamp: string;
  asset: string;
  price: string;
  blockTimestamp: string;
}

interface TokenSwapHistoryResponse {
  data: (SwapHistoryEntry & { timestamp: string })[];
  totalCount: number;
}

const isLPToken = (token: Token): boolean => {
  const symbol = token?.token?._symbol || token?._symbol || '';
  return symbol.endsWith('-LP');
};

const formatLargeNumber = (num: number): string => {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
};

const formatSwapTimestamp = (timestamp: Date) =>
  timestamp.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const fetchPriceHistory = async (assetAddress: string): Promise<PricePoint[]> => {
  try {
    const response = await api.get<{ data: PriceHistoryApiEntry[] }>(`/oracle/price-history/${assetAddress}`);
    
    const processedData = response.data.data
      .filter((entry: PriceHistoryApiEntry) => entry.price && entry.price !== "0") // Filter out zero prices
      .map((entry: PriceHistoryApiEntry) => {
        const date = new Date(entry.blockTimestamp);
        const price = formatUnits(entry.price, 18);
        return {
          date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
          price: price,
          timestamp: date.getTime()
        };
      });

    return processedData;
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return [];
  }
};

const fetchSwapPoolPrices = async (assetAddress: string): Promise<SwapPricePoint[]> => {
  try {
    const response = await api.get<{ data: PriceHistoryApiEntry[] }>(
      `/oracle/strato-price-history/${assetAddress}`
    );

    return (response.data.data || [])
      .filter((entry: PriceHistoryApiEntry) => entry.price && entry.price !== "0")
      .map((entry: PriceHistoryApiEntry) => {
        const date = new Date(entry.blockTimestamp);
        const price = formatUnits(entry.price, 18);
        return {
          date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
          price,
          timestamp: date.getTime(),
        };
      });
  } catch (error) {
    console.error('Failed to fetch STRATO price history:', error);
    return [];
  }
};

const fetchTokenRecentSwaps = async (tokenAddress: string): Promise<(SwapHistoryEntry & { timestamp: Date })[]> => {
  try {
    const { data } = await api.get<TokenSwapHistoryResponse>(`/trade/token-history/${tokenAddress}`, {
      params: { page: 1, limit: RECENT_SWAPS_LIMIT },
    });
    return (data?.data ?? []).map((row) => ({ ...row, timestamp: new Date(row.timestamp) }));
  } catch (error) {
    console.error('Failed to fetch recent swaps:', error);
    return [];
  }
};

const AssetDetail = () => {

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<Token | null>(null);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [priceDataLoading, setPriceDataLoading] = useState(false);
  const [swapPriceData, setSwapPriceData] = useState<SwapPricePoint[]>([]);
  const [swapPriceDataLoading, setSwapPriceDataLoading] = useState(false);
  const [recentSwaps, setRecentSwaps] = useState<(SwapHistoryEntry & { timestamp: Date })[]>([]);
  const [recentSwapsLoading, setRecentSwapsLoading] = useState(false);
  const [canBuy, setCanBuy] = useState(false);
  const [showPriceTooltip, setShowPriceTooltip] = useState(false);
  const { userAddress, isLoggedIn } = useUser()
  const { activeTokens: assets, inactiveTokens, loading, fetchTokens, allActiveTokens } = useUserTokens()
  const { getToken, earningAssets } = useTokenContext();
  const [lookupComplete, setLookupComplete] = useState(false);

  const PRICE_WINDOW = 30; // Number of days to show in the price chart
  
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchTokens()
  }, [userAddress, isLoggedIn])

  useEffect(() => {
    setAsset(null);
    setLookupComplete(false);
    setRecentSwaps([]);
    setCanBuy(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const addr = normBridgeAddr(id);
    if (!addr) {
      setCanBuy(false);
      return;
    }
    fetchBridgeBuyableAddresses()
      .then((set) => {
        if (!cancelled) setCanBuy(set.has(addr));
      })
      .catch(() => {
        if (!cancelled) setCanBuy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    const setupAsset = (foundAsset: Token) => {
      if (cancelled) return;
      setAsset(foundAsset);
      setLookupComplete(true);
      document.title = `${foundAsset?.token?._name || foundAsset?._name} | Asset Details`;

      // Fetch oracle price history if address exists
      if (foundAsset?.address) {
        setPriceDataLoading(true);
        fetchPriceHistory(foundAsset.address)
          .then(data => {
            if (!cancelled) setPriceData(data.slice(-(PRICE_WINDOW * 24)));
          })
          .finally(() => {
            if (!cancelled) setPriceDataLoading(false);
          });

        // Only fetch swap pool prices for non-LP tokens
        if (isLPToken(foundAsset)) {
          setSwapPriceData([]);
          setSwapPriceDataLoading(false);
        } else {
          setSwapPriceDataLoading(true);
          fetchSwapPoolPrices(foundAsset.address)
            .then(data => {
              if (!cancelled) setSwapPriceData(data);
            })
            .finally(() => {
              if (!cancelled) setSwapPriceDataLoading(false);
            });
        }

        setRecentSwapsLoading(true);
        fetchTokenRecentSwaps(foundAsset.address)
          .then((data) => {
            if (!cancelled) setRecentSwaps(data);
          })
          .finally(() => {
            if (!cancelled) setRecentSwapsLoading(false);
          });
      }
    };

    // Find asset across all token sources
    const foundAsset = 
      assets.find(a => a?.address === id) ||
      inactiveTokens.find(a => a?.address === id) ||
      allActiveTokens.find(a => a?.address === id);

    if (foundAsset) {
      setupAsset(foundAsset);
    } else if (id) {
      getToken(id)
        .then((token) => {
          if (!cancelled && token && token.address) {
            setupAsset(token);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLookupComplete(true);
        });
    } else {
      setLookupComplete(true);
    }

    return () => {
      cancelled = true;
    };
  }, [id, assets, inactiveTokens, allActiveTokens, getToken]);

  if (!asset) {
    const isLoading = !lookupComplete || loading;
    return (
      <div className="min-h-screen bg-background">
        <DashboardSidebar />
        <div className="transition-[padding-left] duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
          <DashboardHeader title={isLoading ? "Loading..." : "Asset not found"} />
          {isLoading ?
            <div className="flex justify-center items-center h-40">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
            :
            <main className="p-6">
              <div className="text-center py-12">
                <h2 className="text-2xl font-bold mb-4">Asset not found</h2>
                <p className="text-muted-foreground mb-6">The asset you are looking for does not exist or has been removed.</p>
                <Link to="/dashboard/deposits">
                  <Button>Back to deposits</Button>
                </Link>
              </div>
            </main>
          }
        </div>
      </div>
    );
  }

  // const handleConnectWallet = () => { };

  // const handleBuyNow = () => { };

  // const handleBridge = () => { };

  
  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div className="transition-[padding-left] duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
        <DashboardHeader title={`${asset?.token?._symbol || asset?._symbol} Details`} />

        <main className="p-6">
          <div className="mb-6">
            <Link to="/dashboard/deposits" className="inline-flex items-center text-primary hover:text-primary/80">
              <ChevronLeft size={16} className="mr-1" /> Back to deposits
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Asset Summary Card */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-6 space-y-6">
                <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-primary">{asset?.token?._symbol || asset?._symbol}</p>
                      <CardTitle className="text-xl">{asset?.token?._name || asset?._name}</CardTitle>
                    </div>
                    <div
                      className={`w-16 h-16 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden ${asset?.color ? 'text-white' : 'bg-muted text-muted-foreground'}`}
                      style={asset?.color ? { backgroundColor: asset.color } : undefined}
                    >
                      {asset?.token?._symbol?.toUpperCase() || asset?._symbol?.toUpperCase() || "N/A"}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="flex justify-center mb-6">
                    <div
                      className="w-32 h-32 rounded-full bg-card border-4 border-border flex items-center justify-center overflow-hidden relative"
                    >
                      {asset?.token?.images?.length > 0 || asset?.images?.length > 0 ? (
                        <img
                          src={asset?.token?.images[0]?.value || asset?.images[0]?.value}
                          alt={asset?.token?._name || asset?._name}
                          className="w-full h-full object-contain"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-center text-sm font-semibold text-muted-foreground p-2">
                          {asset?.token?._name || asset?._name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div 
                      className="flex justify-between text-sm relative cursor-help"
                      onMouseEnter={() => setShowPriceTooltip(true)}
                      onMouseLeave={() => setShowPriceTooltip(false)}
                    >
                      <span className="text-muted-foreground">Current price:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          {addCommasToInput(formatUnits(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), 18))} USDST
                        </span>
                        
                        {/* Price trend indicator */}
                        {/* {priceData.length > 0 && asset?.price && (() => {
                          const chartColor = getChartColor(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), priceData);
                          const isUp = chartColor === CHART_COLORS.GREEN;
                          const firstPrice = parseFloat(priceData[0].price);
                          
                          return (
                            <div title={isUp ? `Up from initial: $${firstPrice.toFixed(2)}` : `Down from initial: $${firstPrice.toFixed(2)}`}>
                              {isUp ? (
                                <ArrowUp size={14} style={{ color: CHART_COLORS.GREEN }} />
                              ) : (
                                <ArrowDown size={14} style={{ color: CHART_COLORS.RED }} />
                              )}
                            </div>
                          );
                        })()} */}
                      </div>
                      
                      {/* Price timestamp tooltip */}
                      {showPriceTooltip && priceData.length > 0 && (
                        <div className="absolute right-0 top-full mt-1 z-10 bg-popover text-popover-foreground border text-xs rounded py-1 px-2 whitespace-nowrap shadow-lg">
                          Last updated: {(() => {
                            const latestEntry = priceData[priceData.length - 1];
                            if (latestEntry?.timestamp) {
                              return new Date(latestEntry.timestamp).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                              });
                            }
                            return 'Unknown';
                          })()}
                        </div>
                      )}
                    </div>

                    {(() => {
                      const totalSupply = asset?._totalSupply ?? asset?.token?._totalSupply;
                      const marketCap = parseFloat(asset?.marketCap || '0');
                      let supplyLabel = '—';
                      try {
                        if (totalSupply && totalSupply !== '0') {
                          supplyLabel = formatLargeNumber(parseFloat(formatUnits(BigInt(totalSupply), 18)));
                        }
                      } catch { /* invalid supply */ }
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Market cap:</span>
                            <span className="font-medium tabular-nums">
                              {marketCap > 0 ? `$${formatLargeNumber(marketCap)}` : '—'}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total supply:</span>
                            <span className="font-medium tabular-nums">{supplyLabel}</span>
                          </div>
                        </>
                      );
                    })()}

                    {isLoggedIn && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Balance:</span>
                      <span className="font-medium tabular-nums">{formatUnits(BigInt(asset?.balance || "0") + BigInt(asset?.collateralBalance || "0"), 18)}</span>
                    </div>
                    )}

                    {isLoggedIn && (() => {
                      const ea = earningAssets.find(e => e.address === asset?.address);
                      if (!ea?.rebaseFactor || !ea?.rebasingExternalSymbol) return null;
                      const totalBalance = BigInt(asset?.balance || "0") + BigInt(asset?.collateralBalance || "0");
                      const equivalent = (totalBalance * BigInt(ea.rebaseFactor)) / (10n ** 18n);
                      return (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Equivalent {ea.rebasingExternalSymbol}:</span>
                          <span className="font-medium tabular-nums">{formatUnits(equivalent, 18)}</span>
                        </div>
                      );
                    })()}

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Owner:</span>
                      <span className="font-medium">
                        {asset?.token?._owner
                          ? `${asset.token._owner.slice(0, 6)}...${asset.token._owner.slice(-4)}`
                          : asset?._owner ? `${asset?._owner?.slice(0, 6)}...${asset?._owner?.slice(-4)}` : 'N/A'}
                      <CopyButton address={asset?.token?._owner || asset?._owner} />
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Address:</span>
                      <span className="font-medium">
                        {asset?.address
                          ? `${asset.address.slice(0, 6)}...${asset.address.slice(-4)}`
                          : 'N/A'}
                        <CopyButton address={asset?.address} />
                      </span>
                    </div>
                  </div>

                  {asset && canBuy && !isLPToken(asset) && (
                    <Button
                      className="w-full mb-4"
                      onClick={() => navigate(buildFundBuyPath(asset.address))}
                    >
                      Buy
                    </Button>
                  )}
                  {/* {!isWalletConnected ? (
                    <Button
                      onClick={handleConnectWallet}
                      className="w-full flex items-center justify-center gap-2 mb-4"
                    >
                      <Wallet size={16} />
                      Connect Ethereum Wallet
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 justify-center mb-4 text-green-600">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-sm font-medium">Wallet Connected</span>
                      <span className="text-muted-foreground">Address:</span>
                      <span className="font-medium">{asset?.address}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      onClick={handleBuyNow}
                      disabled={!asset?.available || !isWalletConnected}
                      className="w-full"
                    >
                      Buy Now
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={handleBridge}
                      disabled={!isWalletConnected}
                      className="w-full"
                    >
                      Bridge
                    </Button>
                  </div> */}
                </CardContent>
              </Card>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>About {asset?.token?._name || asset?._name}</CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    <div
                      className="prose dark:prose-invert max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: asset?.token?.description || asset?.description }}
                    />
                  </div>
                </CardContent>
              </Card>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-6">
                <ConsolidatedPriceChart
                  spotData={priceData}
                  swapData={swapPriceData}
                  spotLoading={priceDataLoading}
                  swapLoading={swapPriceDataLoading}
                  title="Price history"
                  subtitle={
                    isLPToken(asset)
                      ? "Net Asset Value per token, calculated from pool balances and oracle prices"
                      : "Spot price (blue) and STRATO price (orange)"
                  }
                  isLPToken={isLPToken(asset)}
                />

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Recent swaps</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Latest trades involving {asset?.token?._symbol || asset?._symbol} across all pools
                    </p>
                  </CardHeader>
                  <CardContent className="px-0 pb-0 sm:px-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="pl-6">Time</TableHead>
                            <TableHead>From</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>To</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Pool</TableHead>
                            <TableHead className="pr-6">Trader</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {recentSwapsLoading ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-10">
                                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                              </TableCell>
                            </TableRow>
                          ) : recentSwaps.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                No recent swaps for this token
                              </TableCell>
                            </TableRow>
                          ) : (
                            recentSwaps.map((swap) => (
                              <TableRow key={`${swap.poolAddress ?? ''}-${swap.id}`}>
                                <TableCell className="pl-6 text-sm whitespace-nowrap">
                                  {formatSwapTimestamp(swap.timestamp)}
                                </TableCell>
                                <TableCell className="font-medium text-sm">{swap.tokenIn}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatWeiAmount(swap.amountIn)}
                                </TableCell>
                                <TableCell className="font-medium text-sm">{swap.tokenOut}</TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {formatWeiAmount(swap.amountOut)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {swap.poolName || 'V2'}
                                </TableCell>
                                <TableCell className="pr-6 font-mono text-xs">
                                  <span className="inline-flex items-center gap-1">
                                    {formatHash(swap.sender)}
                                    <CopyButton address={swap.sender} />
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AssetDetail;

import { useState, useEffect } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/axios";
import { formatUnits } from '@/utils/numberUtils';
import { TrendingUp, Coins, Vault, Activity, DollarSign } from 'lucide-react';

interface TokenWithStats {
  address: string;
  name: string;
  symbol: string;
  totalSupply: string;
  marketCap: string;
}

interface TokenStatsResponse {
  totalMarketCap: string;
  tokens: TokenWithStats[];
}

interface CDPAssetStats {
  asset: string;
  symbol: string;
  totalCollateral: string;
  totalScaledDebt: string;
  totalDebtUSD: string;
  collateralValueUSD: string;
  collateralizationRatio: number;
  numberOfVaults: number;
}

interface CDPStatsResponse {
  totalCollateralValueUSD: string;
  totalDebtUSD: string;
  globalCollateralizationRatio: number;
  assets: CDPAssetStats[];
}

interface AssetRevenue {
  asset: string;
  symbol: string;
  revenue: string;
}

interface PeriodRevenue {
  total: string;
  byAsset: AssetRevenue[];
}

interface RevenuePeriod {
  daily: PeriodRevenue;
  weekly: PeriodRevenue;
  monthly: PeriodRevenue;
  ytd: PeriodRevenue;
  allTime: PeriodRevenue;
}

interface ProtocolRevenueResponse {
  totalRevenue: string;
  revenueByPeriod: RevenuePeriod;
}

const MercataStats = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenWithStats[]>([]);
  const [totalMarketCap, setTotalMarketCap] = useState<string>('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // CDP Stats state
  const [cdpAssets, setCdpAssets] = useState<CDPAssetStats[]>([]);
  const [totalCollateralValueUSD, setTotalCollateralValueUSD] = useState<string>('0');
  const [totalDebtUSD, setTotalDebtUSD] = useState<string>('0');
  const [globalCollateralizationRatio, setGlobalCollateralizationRatio] = useState<number>(0);
  const [cdpLoading, setCdpLoading] = useState(true);
  const [cdpError, setCdpError] = useState<string | null>(null);

  // Protocol Revenue state
  const [cdpTotalRevenue, setCdpTotalRevenue] = useState<string>('0');
  const [cdpRevenueByPeriod, setCdpRevenueByPeriod] = useState<RevenuePeriod>({
    daily: { total: '0', byAsset: [] },
    weekly: { total: '0', byAsset: [] },
    monthly: { total: '0', byAsset: [] },
    ytd: { total: '0', byAsset: [] },
    allTime: { total: '0', byAsset: [] }
  });
  
  const [swapTotalRevenue, setSwapTotalRevenue] = useState<string>('0');
  const [swapRevenueByPeriod, setSwapRevenueByPeriod] = useState<RevenuePeriod>({
    daily: { total: '0', byAsset: [] },
    weekly: { total: '0', byAsset: [] },
    monthly: { total: '0', byAsset: [] },
    ytd: { total: '0', byAsset: [] },
    allTime: { total: '0', byAsset: [] }
  });
  
  const [lendingTotalRevenue, setLendingTotalRevenue] = useState<string>('0');
  const [lendingRevenueByPeriod, setLendingRevenueByPeriod] = useState<RevenuePeriod>({
    daily: { total: '0', byAsset: [] },
    weekly: { total: '0', byAsset: [] },
    monthly: { total: '0', byAsset: [] },
    ytd: { total: '0', byAsset: [] },
    allTime: { total: '0', byAsset: [] }
  });
  
  const [selectedPeriod, setSelectedPeriod] = useState<keyof RevenuePeriod>('allTime');
  const [revenueSource, setRevenueSource] = useState<'cdp' | 'swap' | 'lending' | 'combined'>('combined');
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  useEffect(() => {
    fetchTokenStats();
    fetchCDPStats();
    fetchProtocolRevenue();
  }, []);

  const fetchTokenStats = async () => {
    try {
      setLoading(true);
      const response = await api.get<TokenStatsResponse>('/tokens/stats');
      
      // Tokens are already sorted by market cap in backend
      setTokens(response.data.tokens);
      setTotalMarketCap(response.data.totalMarketCap);
    } catch (err) {
      console.error('Failed to fetch token stats:', err);
      setError('Failed to load token statistics');
    } finally {
      setLoading(false);
    }
  };

  const fetchCDPStats = async () => {
    try {
      setCdpLoading(true);
      const response = await api.get<CDPStatsResponse>('/cdp/stats');
      
      setCdpAssets(response.data.assets);
      setTotalCollateralValueUSD(response.data.totalCollateralValueUSD);
      setTotalDebtUSD(response.data.totalDebtUSD);
      setGlobalCollateralizationRatio(response.data.globalCollateralizationRatio);
    } catch (err) {
      console.error('Failed to fetch CDP stats:', err);
      setCdpError('Failed to load CDP statistics');
    } finally {
      setCdpLoading(false);
    }
  };

  const fetchProtocolRevenue = async () => {
    try {
      setRevenueLoading(true);
      
      // Fetch aggregated protocol revenue from the new centralized endpoint
      const response = await api.get<{
        totalRevenue: string;
        byProtocol: {
          cdp: ProtocolRevenueResponse;
          lending: ProtocolRevenueResponse;
          swap: ProtocolRevenueResponse;
        };
        aggregated: RevenuePeriod;
      }>('/protocol-fees/revenue');
      
      // Extract data for each protocol from the aggregated response
      setCdpTotalRevenue(response.data.byProtocol.cdp.totalRevenue);
      setCdpRevenueByPeriod(response.data.byProtocol.cdp.revenueByPeriod);
      
      setSwapTotalRevenue(response.data.byProtocol.swap.totalRevenue);
      setSwapRevenueByPeriod(response.data.byProtocol.swap.revenueByPeriod);
      
      setLendingTotalRevenue(response.data.byProtocol.lending.totalRevenue);
      setLendingRevenueByPeriod(response.data.byProtocol.lending.revenueByPeriod);
    } catch (err) {
      console.error('Failed to fetch protocol revenue:', err);
      setRevenueError('Failed to load protocol revenue');
    } finally {
      setRevenueLoading(false);
    }
  };

  const formatLargeNumber = (num: number): string => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
  };

  const formatSupply = (supply: string): string => {
    const num = parseFloat(formatUnits(BigInt(supply || '0'), 18));
    return formatLargeNumber(num);
  };

  const formatCR = (cr: number): string => {
    if (cr >= Number.MAX_SAFE_INTEGER) {
      return '∞';
    }
    return `${cr.toFixed(2)}%`;
  };
  
  // Helper to combine revenue data from CDP, Swap, and Lending
  const getCombinedRevenue = (period: keyof RevenuePeriod): PeriodRevenue => {
    const cdpPeriod = cdpRevenueByPeriod[period];
    const swapPeriod = swapRevenueByPeriod[period];
    const lendingPeriod = lendingRevenueByPeriod[period];
    
    // Combine totals
    const combinedTotal = (BigInt(cdpPeriod.total) + BigInt(swapPeriod.total) + BigInt(lendingPeriod.total)).toString();
    
    // Combine by asset
    const assetMap = new Map<string, { symbol: string; revenue: bigint }>();
    
    // Add CDP revenue
    cdpPeriod.byAsset.forEach(item => {
      const existing = assetMap.get(item.asset) || { symbol: item.symbol, revenue: 0n };
      assetMap.set(item.asset, {
        symbol: item.symbol,
        revenue: existing.revenue + BigInt(item.revenue)
      });
    });
    
    // Add Swap revenue
    swapPeriod.byAsset.forEach(item => {
      const existing = assetMap.get(item.asset) || { symbol: item.symbol, revenue: 0n };
      assetMap.set(item.asset, {
        symbol: item.symbol,
        revenue: existing.revenue + BigInt(item.revenue)
      });
    });
    
    // Add Lending revenue
    lendingPeriod.byAsset.forEach(item => {
      const existing = assetMap.get(item.asset) || { symbol: item.symbol, revenue: 0n };
      assetMap.set(item.asset, {
        symbol: item.symbol,
        revenue: existing.revenue + BigInt(item.revenue)
      });
    });
    
    // Convert back to array and sort by revenue
    const combinedAssets = Array.from(assetMap.entries())
      .map(([asset, data]) => ({
        asset,
        symbol: data.symbol,
        revenue: data.revenue.toString()
      }))
      .sort((a, b) => {
        const revenueA = BigInt(a.revenue);
        const revenueB = BigInt(b.revenue);
        if (revenueA > revenueB) return -1;
        if (revenueA < revenueB) return 1;
        return 0;
      });
    
    return {
      total: combinedTotal,
      byAsset: combinedAssets
    };
  };
  
  // Helper to get the appropriate revenue data based on source
  const getRevenueData = (source: typeof revenueSource): { total: string; byPeriod: RevenuePeriod } => {
    if (source === 'cdp') {
      return { total: cdpTotalRevenue, byPeriod: cdpRevenueByPeriod };
    } else if (source === 'swap') {
      return { total: swapTotalRevenue, byPeriod: swapRevenueByPeriod };
    } else if (source === 'lending') {
      return { total: lendingTotalRevenue, byPeriod: lendingRevenueByPeriod };
    } else {
      // Combined
      const combinedTotal = (BigInt(cdpTotalRevenue) + BigInt(swapTotalRevenue) + BigInt(lendingTotalRevenue)).toString();
      const combinedByPeriod: RevenuePeriod = {
        daily: getCombinedRevenue('daily'),
        weekly: getCombinedRevenue('weekly'),
        monthly: getCombinedRevenue('monthly'),
        ytd: getCombinedRevenue('ytd'),
        allTime: getCombinedRevenue('allTime')
      };
      return { total: combinedTotal, byPeriod: combinedByPeriod };
    }
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Mercata Stats" onMenuClick={() => setIsMobileSidebarOpen(true)} />
        
        <main className="p-6">
          <div className="max-w-7xl mx-auto">
            <Tabs defaultValue="tokens" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="tokens">
                  <Coins className="h-4 w-4 mr-2" />
                  Token Stats
                </TabsTrigger>
                <TabsTrigger value="cdp">
                  <Vault className="h-4 w-4 mr-2" />
                  CDP Stats
                </TabsTrigger>
                <TabsTrigger value="revenue">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Protocol Revenue
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tokens">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Market Cap</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {loading ? <Skeleton className="h-8 w-24" /> : `$${formatLargeNumber(parseFloat(totalMarketCap))}`}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Across all active tokens
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Token Stats Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Token Statistics</CardTitle>
                    <CardDescription>
                      Detailed breakdown of token supplies and market capitalizations
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {error ? (
                      <div className="text-center text-red-500 py-8">{error}</div>
                    ) : loading ? (
                      <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Token</TableHead>
                              <TableHead className="text-right">Total Supply</TableHead>
                              <TableHead className="text-right">Market Cap</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tokens.map((token) => (
                              <TableRow key={token.address}>
                                <TableCell className="font-medium">
                                  <div>
                                    <div className="font-semibold">{token.symbol}</div>
                                    <div className="text-sm text-gray-500">{token.name}</div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{formatSupply(token.totalSupply)}</TableCell>
                                <TableCell className="text-right font-semibold">${formatLargeNumber(parseFloat(token.marketCap))}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cdp">
                {/* CDP Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Collateral Value</CardTitle>
                      <Vault className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {cdpLoading ? <Skeleton className="h-8 w-24" /> : `$${formatLargeNumber(parseFloat(formatUnits(BigInt(totalCollateralValueUSD || '0'), 18)))}`}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total value locked in CDPs
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Debt</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {cdpLoading ? <Skeleton className="h-8 w-24" /> : `$${formatLargeNumber(parseFloat(formatUnits(BigInt(totalDebtUSD || '0'), 18)))}`}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total USDST owed
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Global CR</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {cdpLoading ? <Skeleton className="h-8 w-24" /> : formatCR(globalCollateralizationRatio)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Overall collateralization ratio
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* CDP Stats Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>CDP Statistics by Asset</CardTitle>
                    <CardDescription>
                      Aggregated collateral and debt data for each asset
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {cdpError ? (
                      <div className="text-center text-red-500 py-8">{cdpError}</div>
                    ) : cdpLoading ? (
                      <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead className="text-right">Number of Vaults</TableHead>
                              <TableHead className="text-right">Total Collateral Value</TableHead>
                              <TableHead className="text-right">Total Debt (USDST)</TableHead>
                              <TableHead className="text-right">CR</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {cdpAssets.map((asset) => (
                              <TableRow key={asset.asset}>
                                <TableCell>
                                  <div>
                                    <div>{asset.symbol}</div>
                                    <div className="text-sm text-gray-500">{asset.asset.slice(0, 6)}...{asset.asset.slice(-4)}</div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{asset.numberOfVaults}</TableCell>
                                <TableCell className="text-right font-semibold">
                                  ${formatLargeNumber(parseFloat(formatUnits(BigInt(asset.collateralValueUSD || '0'), 18)))}
                                </TableCell>
                                <TableCell className="text-right font-semibold">
                                  ${formatLargeNumber(parseFloat(formatUnits(BigInt(asset.totalDebtUSD || '0'), 18)))}
                                </TableCell>
                                <TableCell className="text-right">
                                  {formatCR(asset.collateralizationRatio)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="revenue">
                {/* Revenue Source Selector */}
                <div className="flex flex-col gap-4 mb-6">
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      onClick={() => setRevenueSource('combined')}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        revenueSource === 'combined' 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Combined Revenue
                    </button>
                    <button
                      onClick={() => setRevenueSource('cdp')}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        revenueSource === 'cdp' 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      CDP Revenue
                    </button>
                    <button
                      onClick={() => setRevenueSource('swap')}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        revenueSource === 'swap' 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Swap Pool Revenue
                    </button>
                    <button
                      onClick={() => setRevenueSource('lending')}
                      className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                        revenueSource === 'lending' 
                          ? 'bg-green-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Lending Revenue
                    </button>
                  </div>
                  
                  {/* Time Period Selector */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedPeriod('daily')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedPeriod === 'daily' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Daily
                    </button>
                    <button
                      onClick={() => setSelectedPeriod('weekly')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedPeriod === 'weekly' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Weekly
                    </button>
                    <button
                      onClick={() => setSelectedPeriod('monthly')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedPeriod === 'monthly' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      onClick={() => setSelectedPeriod('ytd')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedPeriod === 'ytd' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      YTD
                    </button>
                    <button
                      onClick={() => setSelectedPeriod('allTime')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        selectedPeriod === 'allTime' 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      All Time
                    </button>
                  </div>
                </div>

                {/* Revenue Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                  <Card className={revenueSource !== 'swap' && revenueSource !== 'lending' ? '' : 'opacity-50'}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">CDP Revenue</CardTitle>
                      <Vault className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(cdpRevenueByPeriod[selectedPeriod].total || '0'), 18)))}`
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPeriod === 'allTime' ? 'All-time' : selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} CDP fees
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className={revenueSource !== 'cdp' && revenueSource !== 'lending' ? '' : 'opacity-50'}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Swap Pool Revenue</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(swapRevenueByPeriod[selectedPeriod].total || '0'), 18)))}`
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPeriod === 'allTime' ? 'All-time' : selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} swap fees
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className={revenueSource !== 'cdp' && revenueSource !== 'swap' ? '' : 'opacity-50'}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Lending Revenue</CardTitle>
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(lendingRevenueByPeriod[selectedPeriod].total || '0'), 18)))}`
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPeriod === 'allTime' ? 'All-time' : selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} lending fees
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-2 border-green-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {revenueSource === 'combined' && 'Combined Revenue'}
                        {revenueSource === 'cdp' && 'CDP Revenue'}
                        {revenueSource === 'swap' && 'Swap Pool Revenue'}
                        {revenueSource === 'lending' && 'Lending Revenue'}
                      </CardTitle>
                      <DollarSign className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(getRevenueData(revenueSource).byPeriod[selectedPeriod].total || '0'), 18)))}`
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPeriod === 'daily' && 'Last 24 hours'}
                        {selectedPeriod === 'weekly' && 'Last 7 days'}
                        {selectedPeriod === 'monthly' && 'Last 30 days'}
                        {selectedPeriod === 'ytd' && 'Year-to-date'}
                        {selectedPeriod === 'allTime' && 'All-time total'}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Revenue by Asset Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {revenueSource === 'combined' && 'Combined Revenue by Asset'}
                      {revenueSource === 'cdp' && 'CDP Revenue by Asset'}
                      {revenueSource === 'swap' && 'Swap Pool Revenue by Asset'}
                    </CardTitle>
                    <CardDescription>
                      {revenueSource === 'combined' && 'Total protocol revenue from both CDP and swap pools by asset'}
                      {revenueSource === 'cdp' && 'Protocol revenue from CDP operations by collateral asset'}
                      {revenueSource === 'swap' && 'Protocol revenue from swap pool fees by token'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {revenueError ? (
                      <div className="text-center text-red-500 py-8">{revenueError}</div>
                    ) : revenueLoading ? (
                      <div className="space-y-3">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : getRevenueData(revenueSource).byPeriod[selectedPeriod].byAsset.length === 0 ? (
                      <div className="text-center text-gray-500 py-8">No revenue data available for this period</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead className="text-center">Source</TableHead>
                              <TableHead className="text-right">Revenue (USDST)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {getRevenueData(revenueSource).byPeriod[selectedPeriod].byAsset.map((item) => {
                              // For combined view, show which source(s) contributed
                              const hasCdpRevenue = cdpRevenueByPeriod[selectedPeriod].byAsset.some(
                                cdpItem => cdpItem.asset === item.asset && BigInt(cdpItem.revenue) > 0n
                              );
                              const hasSwapRevenue = swapRevenueByPeriod[selectedPeriod].byAsset.some(
                                swapItem => swapItem.asset === item.asset && BigInt(swapItem.revenue) > 0n
                              );
                              const hasLendingRevenue = lendingRevenueByPeriod[selectedPeriod].byAsset.some(
                                lendingItem => lendingItem.asset === item.asset && BigInt(lendingItem.revenue) > 0n
                              );
                              
                              return (
                                <TableRow key={item.asset}>
                                  <TableCell>
                                    <div>
                                      <div className="font-semibold">{item.symbol}</div>
                                      <div className="text-sm text-gray-500">{item.asset.slice(0, 6)}...{item.asset.slice(-4)}</div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {revenueSource === 'combined' ? (
                                      <div className="flex justify-center gap-2">
                                        {hasCdpRevenue && (
                                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">CDP</span>
                                        )}
                                        {hasSwapRevenue && (
                                          <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded">Swap</span>
                                        )}
                                        {hasLendingRevenue && (
                                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Lending</span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className={`text-xs px-2 py-1 rounded ${
                                        revenueSource === 'cdp' 
                                          ? 'bg-blue-100 text-blue-800'
                                          : revenueSource === 'swap'
                                          ? 'bg-purple-100 text-purple-800'
                                          : 'bg-green-100 text-green-800'
                                      }`}>
                                        {revenueSource === 'cdp' ? 'CDP' : revenueSource === 'swap' ? 'Swap' : 'Lending'}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold">
                                    ${formatLargeNumber(parseFloat(formatUnits(BigInt(item.revenue || '0'), 18)))}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MercataStats;

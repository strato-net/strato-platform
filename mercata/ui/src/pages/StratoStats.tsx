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

interface AggregatedRevenueResponse {
  totalRevenue: string;
  byProtocol: {
    cdp: ProtocolRevenueResponse;
    lending: ProtocolRevenueResponse;
    swap: ProtocolRevenueResponse;
    gas: ProtocolRevenueResponse;
  };
  aggregated: RevenuePeriod;
}

interface InterestAccruedResponse {
  totalDailyInterestUSD: string;
  totalWeeklyInterestUSD: string;
  totalMonthlyInterestUSD: string;
  totalYtdInterestUSD: string;
  totalAllTimeInterestUSD: string;
  assets: {
    asset: string;
    symbol: string;
    totalDebtUSD: string;
    annualRatePercent: number;
    dailyInterestUSD: string;
    weeklyInterestUSD: string;
    monthlyInterestUSD: string;
    ytdInterestUSD: string;
    allTimeInterestUSD: string;
  }[];
}

interface LendingInterestAccruedResponse {
  totalDailyRevenueUSD: string;
  totalWeeklyRevenueUSD: string;
  totalMonthlyRevenueUSD: string;
  totalYtdRevenueUSD: string;
  totalAllTimeRevenueUSD: string;
  borrowableAsset: {
    asset: string;
    symbol: string;
    totalDebtUSD: string;
    annualRatePercent: number;
    dailyRevenueUSD: string;
    weeklyRevenueUSD: string;
    monthlyRevenueUSD: string;
    ytdRevenueUSD: string;
    allTimeRevenueUSD: string;
  };
}

const createEmptyRevenuePeriod = (): RevenuePeriod => ({
  daily: { total: '0', byAsset: [] },
  weekly: { total: '0', byAsset: [] },
  monthly: { total: '0', byAsset: [] },
  ytd: { total: '0', byAsset: [] },
  allTime: { total: '0', byAsset: [] }
});

const StratoStats = () => {
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
  const [cdpRevenueByPeriod, setCdpRevenueByPeriod] = useState<RevenuePeriod>(createEmptyRevenuePeriod());

  const [swapTotalRevenue, setSwapTotalRevenue] = useState<string>('0');
  const [swapRevenueByPeriod, setSwapRevenueByPeriod] = useState<RevenuePeriod>(createEmptyRevenuePeriod());

  const [lendingTotalRevenue, setLendingTotalRevenue] = useState<string>('0');
  const [lendingRevenueByPeriod, setLendingRevenueByPeriod] = useState<RevenuePeriod>(createEmptyRevenuePeriod());

  const [gasTotalRevenue, setGasTotalRevenue] = useState<string>('0');
  const [gasRevenueByPeriod, setGasRevenueByPeriod] = useState<RevenuePeriod>(createEmptyRevenuePeriod());

  const [aggregatedRevenueByPeriod, setAggregatedRevenueByPeriod] = useState<RevenuePeriod>(createEmptyRevenuePeriod());

  const [selectedPeriod, setSelectedPeriod] = useState<keyof RevenuePeriod>('allTime');
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  // Interest Accrued state (CDP estimated interest)
  const [interestAccrued, setInterestAccrued] = useState<InterestAccruedResponse | null>(null);
  const [interestLoading, setInterestLoading] = useState(true);

  // Lending Interest Accrued state
  const [lendingInterestAccrued, setLendingInterestAccrued] = useState<LendingInterestAccruedResponse | null>(null);
  const [lendingInterestLoading, setLendingInterestLoading] = useState(true);

  useEffect(() => {
    fetchTokenStats();
    fetchCDPStats();
    fetchProtocolRevenue();
    fetchInterestAccrued();
    fetchLendingInterestAccrued();
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
      const response = await api.get<AggregatedRevenueResponse>('/protocol-fees/revenue');

      // Extract data for each protocol from the aggregated response
      setAggregatedRevenueByPeriod(response.data.aggregated);

      setCdpTotalRevenue(response.data.byProtocol.cdp.totalRevenue);
      setCdpRevenueByPeriod(response.data.byProtocol.cdp.revenueByPeriod);

      setSwapTotalRevenue(response.data.byProtocol.swap.totalRevenue);
      setSwapRevenueByPeriod(response.data.byProtocol.swap.revenueByPeriod);

      setLendingTotalRevenue(response.data.byProtocol.lending.totalRevenue);
      setLendingRevenueByPeriod(response.data.byProtocol.lending.revenueByPeriod);

      setGasTotalRevenue(response.data.byProtocol.gas.totalRevenue);
      setGasRevenueByPeriod(response.data.byProtocol.gas.revenueByPeriod);
    } catch (err) {
      console.error('Failed to fetch protocol revenue:', err);
      setRevenueError('Failed to load protocol revenue');
    } finally {
      setRevenueLoading(false);
    }
  };

  const fetchInterestAccrued = async () => {
    try {
      setInterestLoading(true);
      const response = await api.get<InterestAccruedResponse>('/cdp/interest');
      setInterestAccrued(response.data);
    } catch (err) {
      console.error('Failed to fetch interest accrued:', err);
    } finally {
      setInterestLoading(false);
    }
  };

  const fetchLendingInterestAccrued = async () => {
    try {
      setLendingInterestLoading(true);
      const response = await api.get<LendingInterestAccruedResponse>('/lending/interest');
      setLendingInterestAccrued(response.data);
    } catch (err) {
      console.error('Failed to fetch lending interest accrued:', err);
    } finally {
      setLendingInterestLoading(false);
    }
  };

  const getEstimatedInterestForPeriod = (period: keyof RevenuePeriod): string => {
    if (!interestAccrued) return '0';
    switch (period) {
      case 'daily':
        return interestAccrued.totalDailyInterestUSD;
      case 'weekly':
        return interestAccrued.totalWeeklyInterestUSD;
      case 'monthly':
        return interestAccrued.totalMonthlyInterestUSD;
      case 'ytd':
        return interestAccrued.totalYtdInterestUSD;
      case 'allTime':
        return interestAccrued.totalAllTimeInterestUSD;
      default:
        return '0';
    }
  };

  const getLendingEstimatedRevenueForPeriod = (period: keyof RevenuePeriod): string => {
    if (!lendingInterestAccrued) return '0';
    switch (period) {
      case 'daily':
        return lendingInterestAccrued.totalDailyRevenueUSD;
      case 'weekly':
        return lendingInterestAccrued.totalWeeklyRevenueUSD;
      case 'monthly':
        return lendingInterestAccrued.totalMonthlyRevenueUSD;
      case 'ytd':
        return lendingInterestAccrued.totalYtdRevenueUSD;
      case 'allTime':
        return lendingInterestAccrued.totalAllTimeRevenueUSD;
      default:
        return '0';
    }
  };

  // True accrued interest = paid (CDP revenue) + outstanding (unpaid)
  const getCDPActualAccruedInterest = (period: keyof RevenuePeriod): string => {
    const paidInterest = BigInt(cdpRevenueByPeriod[period]?.total || '0');
    const outstandingInterest = BigInt(getEstimatedInterestForPeriod(period) || '0');
    return (paidInterest + outstandingInterest).toString();
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

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="STRATO Stats" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <div className="max-w-7xl mx-auto">
            <Tabs defaultValue="tokens" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-6">
                <TabsTrigger value="tokens">
                  Token Stats
                </TabsTrigger>
                <TabsTrigger value="cdp">
                  CDP Stats
                </TabsTrigger>
                <TabsTrigger value="revenue">
                  Protocol Revenue
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tokens">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Market Cap</CardTitle>
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
                      <div className="text-center text-destructive py-8">{error}</div>
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
                                    <div className="text-sm text-muted-foreground">{token.name}</div>
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
                      <div className="text-center text-destructive py-8">{cdpError}</div>
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
                                    <div className="text-sm text-muted-foreground">{asset.asset.slice(0, 6)}...{asset.asset.slice(-4)}</div>
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
                {/* Time Period Selector */}
                <div className="flex flex-wrap gap-2 mb-6">
                  <button
                    onClick={() => setSelectedPeriod('daily')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedPeriod === 'daily'
                      ? 'bg-blue-600 text-white dark:bg-blue-700'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                  >
                    Daily
                  </button>
                  <button
                    onClick={() => setSelectedPeriod('weekly')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedPeriod === 'weekly'
                      ? 'bg-blue-600 text-white dark:bg-blue-700'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                  >
                    Weekly
                  </button>
                  <button
                    onClick={() => setSelectedPeriod('monthly')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedPeriod === 'monthly'
                      ? 'bg-blue-600 text-white dark:bg-blue-700'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setSelectedPeriod('ytd')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedPeriod === 'ytd'
                      ? 'bg-blue-600 text-white dark:bg-blue-700'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                  >
                    YTD
                  </button>
                  <button
                    onClick={() => setSelectedPeriod('allTime')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedPeriod === 'allTime'
                      ? 'bg-blue-600 text-white dark:bg-blue-700'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                  >
                    All Time
                  </button>
                </div>

                {/* Revenue Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-6">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">CDP Revenue</CardTitle>
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
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="text-lg font-semibold">
                          {(revenueLoading || interestLoading) ? (
                            <Skeleton className="h-6 w-20" />
                          ) : (
                            `$${formatLargeNumber(parseFloat(formatUnits(BigInt(getCDPActualAccruedInterest(selectedPeriod) || '0'), 18)))}`
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {selectedPeriod === 'allTime'
                            ? 'Actual accrued interest'
                            : `Est. ${selectedPeriod} accrued interest`}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Lending Revenue</CardTitle>
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
                      <div className="mt-3 pt-3 border-t border-border">
                        <div className="text-lg font-semibold">
                          {lendingInterestLoading ? (
                            <Skeleton className="h-6 w-20" />
                          ) : (
                            `$${formatLargeNumber(parseFloat(formatUnits(BigInt(getLendingEstimatedRevenueForPeriod(selectedPeriod) || '0'), 18)))}`
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {selectedPeriod === 'allTime'
                            ? 'Actual accrued interest'
                            : `Est. ${selectedPeriod} accrued interest`}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Swap Pool Revenue</CardTitle>
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

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Gas Fee Revenue</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(gasRevenueByPeriod[selectedPeriod].total || '0'), 18)))}`
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPeriod === 'allTime' ? 'All-time' : selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} gas fees
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-2 border-green-500 dark:border-green-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Combined Revenue</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {revenueLoading ? (
                          <Skeleton className="h-8 w-24" />
                        ) : (
                          `$${formatLargeNumber(parseFloat(formatUnits(BigInt(aggregatedRevenueByPeriod[selectedPeriod].total || '0'), 18)))}`
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
                    <CardTitle>Combined Revenue by Asset</CardTitle>
                    <CardDescription>
                      Total protocol revenue across all sources by asset
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {revenueError ? (
                      <div className="text-center text-destructive py-8">{revenueError}</div>
                    ) : revenueLoading ? (
                      <div className="space-y-3">
                        {[...Array(3)].map((_, i) => (
                          <Skeleton key={i} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : aggregatedRevenueByPeriod[selectedPeriod].byAsset.length === 0 ? (
                      <div className="text-center text-muted-foreground py-8">No revenue data available for this period</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead className="text-right">Revenue (USDST)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {aggregatedRevenueByPeriod[selectedPeriod].byAsset.map((item) => {
                              return (
                                <TableRow key={item.asset}>
                                  <TableCell>
                                    <div>
                                      <div className="font-semibold">{item.symbol}</div>
                                      <div className="text-sm text-muted-foreground">{item.asset.slice(0, 6)}...{item.asset.slice(-4)}</div>
                                    </div>
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

export default StratoStats;

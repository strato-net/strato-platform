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
import { TrendingUp, Coins, Vault, Activity } from 'lucide-react';

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

  useEffect(() => {
    fetchTokenStats();
    fetchCDPStats();
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
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="tokens">
                  <Coins className="h-4 w-4 mr-2" />
                  Token Stats
                </TabsTrigger>
                <TabsTrigger value="cdp">
                  <Vault className="h-4 w-4 mr-2" />
                  CDP Stats
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
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
};

export default MercataStats;

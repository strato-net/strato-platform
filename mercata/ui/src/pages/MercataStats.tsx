import { useState, useEffect } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/axios";
import { formatUnits } from '@/utils/numberUtils';
import { TrendingUp, Coins } from 'lucide-react';

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

const MercataStats = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [tokens, setTokens] = useState<TokenWithStats[]>([]);
  const [totalMarketCap, setTotalMarketCap] = useState<string>('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTokenStats();
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
          </div>
        </main>
      </div>
    </div>
  );
};

export default MercataStats;

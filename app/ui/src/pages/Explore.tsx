import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/axios';
import { formatUnits, safeBigInt } from '@/utils/numberUtils';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';

interface ExploreToken {
  address: string;
  name: string;
  symbol: string;
  image?: string | null;
  totalSupply: string;
  price: string;
  marketCap: string;
  change1h?: number | null;
  change24h?: number | null;
  sparkline?: number[];
}

interface TokenStatsResponse {
  totalMarketCap: string;
  tokens: ExploreToken[];
}

const formatLargeNumber = (num: number): string => {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
};

const formatPrice = (priceWei: string): string => {
  try {
    if (!priceWei || priceWei === '0') return '—';
    const value = parseFloat(formatUnits(BigInt(priceWei), 18));
    if (value >= 1000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    if (value >= 1) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
  } catch {
    return '—';
  }
};

const formatWeiAsAmount = (wei?: string | bigint | null): string => {
  try {
    const raw = safeBigInt(wei);
    if (raw === 0n) return '0';
    const value = parseFloat(formatUnits(raw, 18));
    if (value >= 1000) return formatLargeNumber(value);
    if (value >= 1) return value.toFixed(2);
    return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  } catch {
    return '—';
  }
};

const changeClass = (change: number) =>
  change >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500';

const formatChange = (change: number | null | undefined) => {
  if (change == null || Number.isNaN(change)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`;
  return <span className={`tabular-nums font-medium ${changeClass(change)}`}>{label}</span>;
};

const Sparkline = ({
  data,
  change24h,
  width = 96,
  height = 32,
}: {
  data?: number[];
  change24h?: number | null;
  width?: number;
  height?: number;
}) => {
  if (!data || data.length < 2) {
    return <span className="text-muted-foreground">—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  const positive = (change24h ?? data[data.length - 1] - data[0]) >= 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block" aria-hidden>
      <polyline
        fill="none"
        stroke={positive ? '#16a34a' : '#dc2626'}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
};

const TokenLogo = ({ image, symbol, size }: { image?: string | null; symbol: string; size: string }) => {
  const [failed, setFailed] = useState(false);

  if (image && !failed) {
    return (
      <img
        src={image}
        alt={symbol}
        onError={() => setFailed(true)}
        className={`${size} rounded-full object-contain bg-muted shrink-0`}
      />
    );
  }

  return (
    <div className={`${size} rounded-full bg-muted flex items-center justify-center text-xs font-semibold shrink-0`}>
      {(symbol || '?').slice(0, 2).toUpperCase()}
    </div>
  );
};

const Explore = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { activeTokens, inactiveTokens } = useUserTokens();
  const [tokens, setTokens] = useState<ExploreToken[]>([]);
  const [totalMarketCap, setTotalMarketCap] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await api.get<TokenStatsResponse>('/tokens/stats');
        if (cancelled) return;
        setTokens(res.data.tokens || []);
        setTotalMarketCap(res.data.totalMarketCap || '0');
      } catch {
        if (!cancelled) setError('Failed to load tokens');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Matches AssetDetail: holdings include tokens locked as collateral
  const balanceByAddress = useMemo(() => {
    const map = new Map<string, bigint>();
    [...activeTokens, ...inactiveTokens].forEach((t) =>
      map.set(t.address, safeBigInt(t.balance) + safeBigInt(t.collateralBalance))
    );
    return map;
  }, [activeTokens, inactiveTokens]);

  const openToken = (address: string) => navigate(`/dashboard/deposits/${address}`);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Explore" />
        <main className="p-4 md:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Tokens</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Live prices, supply and market cap for every token on STRATO
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Market Cap</div>
                  <div className="text-xl md:text-2xl font-semibold tabular-nums mt-1">
                    {loading ? <Skeleton className="h-7 w-28" /> : `$${formatLargeNumber(parseFloat(totalMarketCap))}`}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Listed Tokens</div>
                  <div className="text-xl md:text-2xl font-semibold tabular-nums mt-1">
                    {loading ? <Skeleton className="h-7 w-12" /> : tokens.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            {error ? (
              <div className="text-center text-destructive py-12">{error}</div>
            ) : loading ? (
              <div className="space-y-3">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-12 text-muted-foreground">#</TableHead>
                        <TableHead>Token</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">1H</TableHead>
                        <TableHead className="text-right">1D</TableHead>
                        <TableHead className="text-right">Market Cap</TableHead>
                        <TableHead className="text-right">Total Supply</TableHead>
                        {isLoggedIn && <TableHead className="text-right">Your Balance</TableHead>}
                        <TableHead className="text-right w-[120px]">1D chart</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tokens.map((token, index) => (
                        <TableRow
                          key={token.address}
                          className="cursor-pointer"
                          onClick={() => openToken(token.address)}
                        >
                          <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <TokenLogo image={token.image} symbol={token.symbol} size="w-8 h-8" />
                              <div className="min-w-0">
                                <div className="font-medium truncate">{token.name}</div>
                                <div className="text-sm text-muted-foreground">{token.symbol}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatPrice(token.price)}
                          </TableCell>
                          <TableCell className="text-right">{formatChange(token.change1h)}</TableCell>
                          <TableCell className="text-right">{formatChange(token.change24h)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            ${formatLargeNumber(parseFloat(token.marketCap || '0'))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatWeiAsAmount(token.totalSupply)}
                          </TableCell>
                          {isLoggedIn && (
                            <TableCell className="text-right tabular-nums">
                              {formatWeiAsAmount(balanceByAddress.get(token.address))}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <Sparkline data={token.sparkline} change24h={token.change24h} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="md:hidden space-y-3">
                  {tokens.map((token, index) => (
                    <button
                      key={token.address}
                      onClick={() => openToken(token.address)}
                      className="w-full text-left rounded-xl border bg-card p-4 active:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-4 shrink-0">{index + 1}</span>
                        <TokenLogo image={token.image} symbol={token.symbol} size="w-9 h-9" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{token.name}</div>
                          <div className="text-xs text-muted-foreground">{token.symbol}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold tabular-nums">{formatPrice(token.price)}</div>
                          <div className="text-xs">{formatChange(token.change24h)}</div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs flex-1">
                          <div>
                            <div className="text-muted-foreground">Market Cap</div>
                            <div className="font-medium tabular-nums">
                              ${formatLargeNumber(parseFloat(token.marketCap || '0'))}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Total Supply</div>
                            <div className="font-medium tabular-nums">{formatWeiAsAmount(token.totalSupply)}</div>
                          </div>
                          {isLoggedIn && (
                            <div>
                              <div className="text-muted-foreground">Your Balance</div>
                              <div className="font-medium tabular-nums">
                                {formatWeiAsAmount(balanceByAddress.get(token.address))}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="text-muted-foreground">1H</div>
                            <div className="font-medium">{formatChange(token.change1h)}</div>
                          </div>
                        </div>
                        <Sparkline data={token.sparkline} change24h={token.change24h} width={72} height={28} />
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default Explore;

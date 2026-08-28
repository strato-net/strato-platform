import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/axios';
import { formatBalance, formatUnits, safeBigInt } from '@/utils/numberUtils';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { metalForgeService } from '@/services/metalForgeService';
import { buildFundBuyPath, buildFundMetalBuyPath, fetchBridgeBuyableAddresses, normBridgeAddr } from '@/lib/bridgeLinks';

type SortKey = 'price' | 'marketCap' | 'totalSupply';
type SortDir = 'asc' | 'desc';

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
  change >= 0 ? 'text-success' : 'text-destructive';

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
        stroke={positive ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
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

const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
  return dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
};

const Explore = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const { earningAssets } = useTokenContext();
  const [tokens, setTokens] = useState<ExploreToken[]>([]);
  const [totalMarketCap, setTotalMarketCap] = useState('0');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [bridgeBuyableAddresses, setBridgeBuyableAddresses] = useState<Set<string> | null>(null);
  const [metalBuyableAddresses, setMetalBuyableAddresses] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchBridgeBuyableAddresses().catch(() => new Set<string>()),
      metalForgeService.getConfigs()
        .then((config) => new Set(config.metals.filter((metal) => metal.isEnabled).map((metal) => normBridgeAddr(metal.address))))
        .catch(() => new Set<string>()),
    ])
      .then(([bridgeAddresses, metalAddresses]) => {
        if (!cancelled) {
          setBridgeBuyableAddresses(bridgeAddresses);
          setMetalBuyableAddresses(metalAddresses);
        }
      })
      .catch(() => {
        if (!cancelled) setBridgeBuyableAddresses(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same source and display as Portfolio "My Tokens": earning assets totalBalance
  const balanceByAddress = useMemo(() => {
    const map = new Map<string, string>();
    earningAssets.forEach((asset) => map.set(asset.address, asset.totalBalance));
    return map;
  }, [earningAssets]);

  const balanceLabel = (address: string) => {
    const total = balanceByAddress.get(address);
    return !total || total === '0' ? '-' : formatBalance(total, undefined, 18, 1, 4);
  };

  const canBuy = (address: string) => {
    const normalizedAddress = normBridgeAddr(address);
    return !!bridgeBuyableAddresses?.has(normalizedAddress) || metalBuyableAddresses.has(normalizedAddress);
  };

  const goBuy = (e: MouseEvent, address: string) => {
    e.stopPropagation();
    navigate(metalBuyableAddresses.has(normBridgeAddr(address))
      ? buildFundMetalBuyPath(address)
      : buildFundBuyPath(address));
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortedTokens = useMemo(() => {
    if (!sortKey) return tokens;
    const mult = sortDir === 'asc' ? 1 : -1;
    return [...tokens].sort((a, b) => {
      if (sortKey === 'marketCap') {
        return (parseFloat(a.marketCap || '0') - parseFloat(b.marketCap || '0')) * mult;
      }
      const av = safeBigInt(sortKey === 'price' ? a.price : a.totalSupply);
      const bv = safeBigInt(sortKey === 'price' ? b.price : b.totalSupply);
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * mult;
    });
  }, [tokens, sortKey, sortDir]);

  const openToken = (address: string) => navigate(`/dashboard/deposits/${address}`);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="transition-[padding-left] duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
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
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Total market cap</div>
                  <div className="text-xl md:text-2xl font-semibold tabular-nums mt-1">
                    {loading ? <Skeleton className="h-7 w-28" /> : `$${formatLargeNumber(parseFloat(totalMarketCap))}`}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Listed tokens</div>
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
                        <TableHead className="text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 ml-auto hover:text-foreground"
                            onClick={() => toggleSort('price')}
                          >
                            Price
                            <SortIcon active={sortKey === 'price'} dir={sortDir} />
                          </button>
                        </TableHead>
                        <TableHead className="text-right">1H</TableHead>
                        <TableHead className="text-right">1D</TableHead>
                        <TableHead className="text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 ml-auto hover:text-foreground"
                            onClick={() => toggleSort('marketCap')}
                          >
                            Market cap
                            <SortIcon active={sortKey === 'marketCap'} dir={sortDir} />
                          </button>
                        </TableHead>
                        <TableHead className="text-right">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 ml-auto hover:text-foreground"
                            onClick={() => toggleSort('totalSupply')}
                          >
                            Total supply
                            <SortIcon active={sortKey === 'totalSupply'} dir={sortDir} />
                          </button>
                        </TableHead>
                        {isLoggedIn && <TableHead className="text-right">Your balance</TableHead>}
                        <TableHead className="text-right w-[120px]">1D chart</TableHead>
                        <TableHead className="text-right w-[88px] sticky right-0 bg-card border-l">
                          Buy
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedTokens.map((token, index) => (
                        <TableRow
                          key={token.address}
                          className="cursor-pointer group"
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
                              {balanceLabel(token.address)}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <Sparkline data={token.sparkline} change24h={token.change24h} />
                          </TableCell>
                          <TableCell className="text-right sticky right-0 bg-card border-l group-hover:bg-muted/50">
                            {bridgeBuyableAddresses &&
                              (canBuy(token.address) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-3"
                                  onClick={(e) => goBuy(e, token.address)}
                                >
                                  Buy
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              ))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="md:hidden space-y-3">
                  {sortedTokens.map((token, index) => (
                    <div
                      key={token.address}
                      className="w-full text-left rounded-xl border bg-card p-4"
                    >
                      <button
                        type="button"
                        onClick={() => openToken(token.address)}
                        className="w-full text-left active:bg-accent/50 transition-colors"
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
                            <div className="text-muted-foreground">Market cap</div>
                            <div className="font-medium tabular-nums">
                              ${formatLargeNumber(parseFloat(token.marketCap || '0'))}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Total supply</div>
                            <div className="font-medium tabular-nums">{formatWeiAsAmount(token.totalSupply)}</div>
                          </div>
                          {isLoggedIn && (
                            <div>
                              <div className="text-muted-foreground">Your balance</div>
                              <div className="font-medium tabular-nums">
                                {balanceLabel(token.address)}
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
                      {canBuy(token.address) && (
                        <Button
                          size="sm"
                          className="w-full mt-3"
                          onClick={(e) => goBuy(e, token.address)}
                        >
                          Buy
                        </Button>
                      )}
                    </div>
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

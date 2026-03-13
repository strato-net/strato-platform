import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useBridgeContext } from '@/context/BridgeContext';
import { getChainName } from '@/lib/bridge/utils';
import { formatBalance } from '@/utils/numberUtils';
import { useIsMobile } from '@/hooks/use-mobile';

type RecentTx = {
  _type: 'deposit' | 'withdrawal';
  block_timestamp?: string;
  externalChainId?: number | string;
  externalSymbol?: string;
  stratoTokenSymbol?: string;
  amount?: string;
  status?: string;
};

const getStatusLabel = (status?: string | number) => {
  const s = parseInt(String(status || "0"));
  if (s === 3) return { text: "Complete", color: "bg-emerald-500/15 text-emerald-500" };
  if (s === 2) return { text: "Pending", color: "bg-amber-500/15 text-amber-500" };
  if (s === 4) return { text: "Aborted", color: "bg-red-500/15 text-red-500" };
  if (s === 1) return { text: "Initiated", color: "bg-blue-500/15 text-blue-500" };
  return { text: "Unknown", color: "bg-muted text-muted-foreground" };
};

const formatTimeAgo = (time?: string) => {
  if (!time) return "-";
  const ts = new Date(time).getTime();
  if (Number.isNaN(ts)) return "-";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
};

const RecentTransactions = () => {
  const { isLoggedIn } = useUser();
  const {
    fetchDepositTransactions,
    fetchWithdrawTransactions,
    depositRefreshKey,
    withdrawalRefreshKey,
  } = useBridgeContext();
  const isMobile = useIsMobile();
  const recentLimit = isMobile ? 6 : 8;
  const [transactions, setTransactions] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const params = { limit: String(recentLimit), offset: "0", order: "block_timestamp.desc" };

    Promise.all([
      fetchDepositTransactions(params, "deposits"),
      fetchWithdrawTransactions(params, "deposits"),
    ])
      .then(([depositResult, withdrawalResult]) => {
        const apiDeposits = (depositResult.data || []) as unknown as Record<string, unknown>[];

        const pendingRaw = JSON.parse(localStorage.getItem('pendingDeposits') || '[]') as Record<string, unknown>[];
        const apiTxHashes = new Set(apiDeposits.map((tx) => tx?.externalTxHash));
        const remainingPending = pendingRaw.filter((p) => !apiTxHashes.has(p?.externalTxHash));
        localStorage.setItem('pendingDeposits', JSON.stringify(remainingPending));

        const pendingTxs: RecentTx[] = remainingPending.map((p) => ({
          _type: 'deposit' as const,
          block_timestamp: p.block_timestamp as string,
          externalChainId: p.externalChainId as string,
          externalSymbol: p.externalSymbol as string,
          stratoTokenSymbol: p.stratoTokenSymbol as string,
          amount: (p.DepositInfo as Record<string, unknown>)?.stratoTokenAmount as string,
          status: (p.DepositInfo as Record<string, unknown>)?.bridgeStatus as string,
        }));

        const deposits: RecentTx[] = apiDeposits.map((tx) => ({
          _type: 'deposit' as const,
          block_timestamp: tx.block_timestamp as string,
          externalChainId: (tx.externalChainId ?? (tx.DepositInfo as Record<string, unknown>)?.externalChainId) as string,
          externalSymbol: tx.externalSymbol as string,
          stratoTokenSymbol: tx.stratoTokenSymbol as string,
          amount: (tx.DepositInfo as Record<string, unknown>)?.stratoTokenAmount as string,
          status: (tx.DepositInfo as Record<string, unknown>)?.bridgeStatus as string,
        }));

        const withdrawals: RecentTx[] = ((withdrawalResult.data || []) as unknown as Record<string, unknown>[]).map((tx) => ({
          _type: 'withdrawal' as const,
          block_timestamp: tx.block_timestamp as string,
          externalChainId: ((tx.WithdrawalInfo as Record<string, unknown>)?.externalChainId ?? tx.externalChainId) as string,
          externalSymbol: tx.externalSymbol as string,
          stratoTokenSymbol: tx.stratoTokenSymbol as string,
          amount: (tx.WithdrawalInfo as Record<string, unknown>)?.stratoTokenAmount as string,
          status: (tx.WithdrawalInfo as Record<string, unknown>)?.bridgeStatus as string,
        }));

        const merged = [...pendingTxs, ...deposits, ...withdrawals]
          .sort((a, b) => new Date(b.block_timestamp || 0).getTime() - new Date(a.block_timestamp || 0).getTime())
          .slice(0, recentLimit);

        setTransactions(merged);
        setLoading(false);
      })
      .catch(() => { setTransactions([]); setLoading(false); });
  }, [isLoggedIn, fetchDepositTransactions, fetchWithdrawTransactions, depositRefreshKey, withdrawalRefreshKey, recentLimit]);

  return (
    <Card className="shadow-sm border border-border/70">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Link
            to="/bridge-transactions?from=deposits"
            className={`text-sm font-semibold ${
              isLoggedIn
                ? "text-blue-500 hover:text-blue-700"
                : "text-muted-foreground pointer-events-none opacity-50"
            }`}
          >
            View All {"\u2192"}
          </Link>
        </div>

        {!isLoggedIn ? (
          <p className="text-sm text-muted-foreground px-4 py-4">Sign in to view your recent activity.</p>
        ) : loading ? (
          <div className="divide-y divide-border/40">
            {Array.from({ length: isMobile ? 4 : 6 }).map((_, i) => (
              <div key={`tx-skel-${i}`} className="flex items-center gap-3 px-4 py-4 animate-pulse">
                <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-24 bg-muted rounded" />
                  <div className="h-3 w-16 bg-muted rounded" />
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="h-3.5 w-20 bg-muted rounded ml-auto" />
                  <div className="h-3 w-14 bg-muted rounded ml-auto" />
                </div>
              </div>
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-4">No recent transactions.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {transactions.map((tx, index) => {
              const status = getStatusLabel(tx.status);
              const isWithdrawal = tx._type === 'withdrawal';
              const amountFormatted = formatBalance(tx.amount || "0", undefined, 18, 2, 4);
              const label = isWithdrawal ? "Withdrawal" : "Deposit";
              const fromSymbol = isWithdrawal ? tx.stratoTokenSymbol : tx.externalSymbol;
              const toSymbol = isWithdrawal ? tx.externalSymbol : tx.stratoTokenSymbol;
              return (
                <div key={`${tx.block_timestamp || "tx"}-${index}`} className="flex items-center gap-3 px-4 py-4">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isWithdrawal ? "bg-amber-500/15" : "bg-emerald-500/15"
                  }`}>
                    {isWithdrawal ? (
                      <ArrowUp className="w-4 h-4 text-amber-500" />
                    ) : (
                      <ArrowDown className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{label}</p>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${status.color}`}>
                        {status.text}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatTimeAgo(tx.block_timestamp)} · {getChainName(Number(tx.externalChainId || 1))}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-foreground">
                      {amountFormatted} {fromSymbol || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {"\u2192"} {amountFormatted} {toSymbol || "-"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RecentTransactions;

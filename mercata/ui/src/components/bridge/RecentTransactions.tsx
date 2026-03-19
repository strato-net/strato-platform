import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Gem, Frown } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useBridgeContext } from '@/context/BridgeContext';
import { formatBalance } from '@/utils/numberUtils';
import { mergePendingDeposits } from '@/lib/bridge/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { activityFeedApi } from '@/lib/activityFeed';
import { METAL_ACTIVITY_PAIR, resolveTokenSymbols, collectMetalTokenAddrs, mapEventsToMetalTxs } from '@/lib/metalActivity';

type RecentTx = {
  _type: 'deposit' | 'withdrawal' | 'metal';
  block_timestamp?: string;
  externalChainId?: number | string;
  externalSymbol?: string;
  stratoTokenSymbol?: string;
  amount?: string;
  status?: string;
  depositOutcome?: 'bridge' | 'save' | 'forge';
  finalTokenSymbol?: string;
  finalAmount?: string;
  paySymbol?: string;
  payAmount?: string;
  metalSymbol?: string;
};

const STATUS_LABELS: Record<number, { text: string; color: string }> = {
  3: { text: "Complete", color: "bg-emerald-500/15 text-emerald-500" },
  2: { text: "Pending", color: "bg-amber-500/15 text-amber-500" },
  4: { text: "Aborted", color: "bg-red-500/15 text-red-500" },
  1: { text: "Initiated", color: "bg-blue-500/15 text-blue-500" },
};
const UNKNOWN_STATUS = { text: "Unknown", color: "bg-muted text-muted-foreground" };
const METAL_STATUS = STATUS_LABELS[3];

const getStatusLabel = (status?: string | number) => STATUS_LABELS[parseInt(String(status || "0"))] || UNKNOWN_STATUS;

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

const TxRow = ({ icon, iconBg, label, status, timeLabel, fromAmount, fromSymbol, toAmount, toSymbol }: {
  icon: React.ReactNode; iconBg: string; label: string;
  status: { text: string; color: string };
  timeLabel: string; fromAmount: string; fromSymbol: string;
  toAmount: string; toSymbol: string;
}) => (
  <div className="flex items-center gap-3 px-4 py-4">
    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${status.color}`}>{status.text}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{timeLabel}</p>
    </div>
    <div className="text-right shrink-0">
      <p className="text-sm font-semibold text-foreground">{fromAmount} {fromSymbol}</p>
      <p className="text-xs text-muted-foreground">{"\u2192"} {toAmount} {toSymbol}</p>
    </div>
  </div>
);

const mapDeposit = (tx: Record<string, unknown>, type: 'api' | 'pending'): RecentTx => {
  const info = tx.DepositInfo as Record<string, unknown> | undefined;
  return {
    _type: 'deposit', block_timestamp: tx.block_timestamp as string,
    externalChainId: (tx.externalChainId ?? info?.externalChainId) as string,
    externalSymbol: tx.externalSymbol as string, stratoTokenSymbol: tx.stratoTokenSymbol as string,
    amount: info?.stratoTokenAmount as string, status: info?.bridgeStatus as string,
    depositOutcome: (type === 'pending'
      ? (tx.type === 'saving' ? 'save' : tx.type === 'forge' ? 'forge' : 'bridge')
      : tx.depositOutcome) as RecentTx['depositOutcome'],
    finalTokenSymbol: tx.finalTokenSymbol as string | undefined,
    finalAmount: tx.finalAmount as string | undefined,
  };
};

const mapWithdrawal = (tx: Record<string, unknown>): RecentTx => {
  const info = tx.WithdrawalInfo as Record<string, unknown> | undefined;
  return {
    _type: 'withdrawal', block_timestamp: tx.block_timestamp as string,
    externalChainId: (info?.externalChainId ?? tx.externalChainId) as string,
    externalSymbol: tx.externalSymbol as string, stratoTokenSymbol: tx.stratoTokenSymbol as string,
    amount: info?.stratoTokenAmount as string, status: info?.bridgeStatus as string,
  };
};

function useMetalTransactions(limit: number, isLoggedIn: boolean) {
  const [transactions, setTransactions] = useState<RecentTx[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!isLoggedIn) { setTransactions([]); loadedRef.current = true; return; }
    if (!loadedRef.current) setLoading(true);
    try {
      const result = await activityFeedApi.getActivities(METAL_ACTIVITY_PAIR, { limit, myActivity: true });
      const events = result.events || [];
      const symbolMap = await resolveTokenSymbols([...collectMetalTokenAddrs(events)]);
      setTransactions(mapEventsToMetalTxs(events, symbolMap).map((tx) => ({
        ...tx, _type: 'metal' as const, amount: tx.metalAmount, status: "3",
      })));
    } catch { setTransactions([]); }
    finally { setLoading(false); loadedRef.current = true; }
  }, [limit, isLoggedIn]);

  return { transactions, loading, load };
}

interface RecentTransactionsProps {
  fundingMode?: "bridge" | "metals";
  metalRefreshKey?: number;
}

const RecentTransactions = ({ fundingMode = "bridge", metalRefreshKey = 0 }: RecentTransactionsProps) => {
  const { isLoggedIn } = useUser();
  const {
    fetchDepositTransactions, fetchWithdrawTransactions,
    availableNetworks, depositRefreshKey, withdrawalRefreshKey,
  } = useBridgeContext();

  const chainNameMap = new Map(availableNetworks.map(n => [String(n.chainId), n.chainName]));
  const isMobile = useIsMobile();
  const recentLimit = isMobile ? 6 : 8;

  const [bridgeTxs, setBridgeTxs] = useState<RecentTx[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const bridgeLoadedRef = useRef(false);

  const metal = useMetalTransactions(recentLimit, isLoggedIn);
  const [lastMetalRefreshKey, setLastMetalRefreshKey] = useState(-1);

  useEffect(() => {
    if (fundingMode !== "bridge") return;
    if (!isLoggedIn) { setBridgeTxs([]); bridgeLoadedRef.current = true; return; }
    if (!bridgeLoadedRef.current) setBridgeLoading(true);
    const params = { limit: String(recentLimit), offset: "0", order: "block_timestamp.desc" };
    Promise.all([
      fetchDepositTransactions(params, "deposits"),
      fetchWithdrawTransactions(params, "deposits"),
    ]).then(([depositResult, withdrawalResult]) => {
      const apiDeposits = (depositResult.data || []) as unknown as Record<string, unknown>[];
      const { remaining } = mergePendingDeposits(apiDeposits);
      const all = [
        ...remaining.map((p: Record<string, unknown>) => mapDeposit(p, 'pending')),
        ...apiDeposits.map((tx) => mapDeposit(tx, 'api')),
        ...((withdrawalResult.data || []) as unknown as Record<string, unknown>[]).map(mapWithdrawal),
      ].sort((a, b) => new Date(b.block_timestamp || 0).getTime() - new Date(a.block_timestamp || 0).getTime())
       .slice(0, recentLimit);
      setBridgeTxs(all);
      setBridgeLoading(false);
      bridgeLoadedRef.current = true;
    }).catch(() => { setBridgeTxs([]); setBridgeLoading(false); bridgeLoadedRef.current = true; });
  }, [isLoggedIn, fundingMode, fetchDepositTransactions, fetchWithdrawTransactions, depositRefreshKey, withdrawalRefreshKey, recentLimit]);

  if (fundingMode === "metals" && isLoggedIn && lastMetalRefreshKey !== metalRefreshKey) {
    setLastMetalRefreshKey(metalRefreshKey);
    metal.load();
  }

  const isBridge = fundingMode === "bridge";

  const renderTxRows = (txs: RecentTx[]) => (
    <div className="divide-y divide-border/40">
      {txs.map((tx, index) => {
        const amt = formatBalance(tx.amount || "0", undefined, 18, 2, 4);
        const key = `${tx.block_timestamp || "tx"}-${index}`;

        if (tx._type === 'metal') {
          return <TxRow key={key} icon={<Gem className="w-4 h-4 text-yellow-600" />} iconBg="bg-yellow-500/15"
            label="Metal Mint" status={METAL_STATUS} timeLabel={formatTimeAgo(tx.block_timestamp)}
            fromAmount={formatBalance(tx.payAmount || "0", undefined, 18, 2, 4)} fromSymbol={tx.paySymbol || "-"}
            toAmount={amt} toSymbol={tx.metalSymbol || "-"} />;
        }

        const isW = tx._type === 'withdrawal';
        const status = getStatusLabel(tx.status);
        const hasOutcome = !isW && tx.depositOutcome && tx.depositOutcome !== "bridge" && tx.finalTokenSymbol;
        return <TxRow key={key}
          icon={isW ? <ArrowUp className="w-4 h-4 text-amber-500" /> : <ArrowDown className="w-4 h-4 text-emerald-500" />}
          iconBg={isW ? "bg-amber-500/15" : "bg-emerald-500/15"}
          label={isW ? "Withdrawal" : "Deposit"} status={status}
          timeLabel={`${formatTimeAgo(tx.block_timestamp)} · ${chainNameMap.get(String(tx.externalChainId)) || "Unknown Chain"}`}
          fromAmount={amt} fromSymbol={(isW ? tx.stratoTokenSymbol : tx.externalSymbol) || "-"}
          toAmount={hasOutcome && tx.finalAmount ? formatBalance(tx.finalAmount, undefined, 18, 2, 4) : amt}
          toSymbol={(hasOutcome ? tx.finalTokenSymbol : (isW ? tx.externalSymbol : tx.stratoTokenSymbol)) || "-"} />;
      })}
    </div>
  );

  const activeTxs = isBridge ? bridgeTxs : metal.transactions;
  const activeLoading = isBridge ? bridgeLoading : metal.loading;
  const viewAllLink = isBridge ? "/bridge-transactions?from=deposits" : "/metal-transactions?from=deposits";
  const linkClass = `text-sm font-semibold ${isLoggedIn ? "text-blue-500 hover:text-blue-700" : "text-muted-foreground pointer-events-none opacity-50"}`;

  const emptyState = !isBridge ? (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-muted-foreground">
      <Frown className="w-10 h-10 mb-2 opacity-30" />
      <span className="text-sm font-medium">No metal purchases found</span>
    </div>
  ) : <p className="text-sm text-muted-foreground px-4 py-4">No recent transactions.</p>;

  const skeleton = (
    <div className="divide-y divide-border/40">
      {Array.from({ length: isMobile ? 4 : 6 }).map((_, i) => (
        <div key={`tx-skel-${i}`} className="flex items-center gap-3 px-4 py-4 animate-pulse">
          <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-1.5"><div className="h-3.5 w-24 bg-muted rounded" /><div className="h-3 w-16 bg-muted rounded" /></div>
          <div className="space-y-1.5 text-right"><div className="h-3.5 w-20 bg-muted rounded ml-auto" /><div className="h-3 w-14 bg-muted rounded ml-auto" /></div>
        </div>
      ))}
    </div>
  );

  return (
    <Card className="shadow-sm border border-border/70">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/70">
          <CardTitle className="text-base">
            {isBridge ? "Recent Transactions" : "Recent Metal Purchases"}
          </CardTitle>
          <Link to={viewAllLink} className={linkClass}>
            View All {"\u2192"}
          </Link>
        </div>

        {!isLoggedIn
          ? <p className="text-sm text-muted-foreground px-4 py-4">Sign in to view your recent activity.</p>
          : activeLoading
            ? skeleton
            : !activeTxs.length
              ? emptyState
              : renderTxRows(activeTxs)
        }
      </CardContent>
    </Card>
  );
};

export default RecentTransactions;

import WithdrawalCancellation from "./WithdrawalCancellation";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Gem, Frown } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useBridgeContext } from '@/context/BridgeContext';
import { formatBalance } from '@/utils/numberUtils';
import { ExternalBridgeStatus, WITHDRAWAL_STATUS_LABELS, getBridgeStatusLabel, getDepositStatusLabel, getExplorerUrl, mergePendingDeposits } from '@/lib/bridge/utils';
import { RECENT_TRANSACTIONS_REFRESH_MS } from '@/lib/bridge/constants';
import { useIsMobile } from '@/hooks/use-mobile';
import { activityFeedApi } from '@/lib/activityFeed';
import { METAL_ACTIVITY_PAIR, resolveTokenMetadata, collectMetalTokenAddrs, mapEventsToMetalTxs } from '@/lib/metalActivity';
import type { BridgeToken, BridgeTransaction } from '@strato/shared-types';
import type { NetworkSummary } from '@/lib/bridge/types';

type RecentTx = {
  withdrawalId?: string;
  sender?: string;
  externalTxHash?: string;
  refundTxHash?: string;
  _type: 'deposit' | 'withdrawal' | 'metal' | 'route';
  block_timestamp?: string;
  externalChainId?: number | string;
  externalSymbol?: string;
  externalAmount?: string;
  externalDecimals?: number;
  stratoTokenSymbol?: string;
  amount?: string;
  status?: string;
  bridgeSource?: BridgeTransaction['bridgeSource'];
  depositOutcome?: 'bridge' | 'save' | 'forge' | 'route' | 'fallback';
  finalTokenSymbol?: string;
  finalAmount?: string;
  paySymbol?: string;
  payAmount?: string;
  metalSymbol?: string;
  stratoToken?: string;
  finalToken?: string;
  amountDecimals?: number;
  finalDecimals?: number;
  payDecimals?: number;
};

const METAL_STATUS = getBridgeStatusLabel(ExternalBridgeStatus.COMPLETED);
const normalizeAddress = (address?: string) =>
  (address || "").toLowerCase().replace(/^0x/, "");

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

const TxRow = ({ icon, iconBg, label, status, timeLabel, fromAmount, fromSymbol, toAmount, toSymbol, refundUrl, transactionUrl, action }: {
  icon: React.ReactNode; iconBg: string; label: string;
  status: { text: string; color: string; description?: string };
  timeLabel: string; fromAmount: string; fromSymbol: string;
  toAmount: string; toSymbol: string; refundUrl?: string; transactionUrl?: string; action?: React.ReactNode;
}) => (
  <div className="flex items-center gap-3 px-4 py-4">
    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${status.color}`}>{status.text}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{timeLabel}</p>
      {transactionUrl && <a className="text-xs text-primary" href={transactionUrl} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}
      {action}
      {refundUrl && <a className="text-xs text-primary" href={refundUrl} target="_blank" rel="noopener noreferrer">View refund ↗</a>}
      {status.description && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{status.description}</p>}
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
    refundTxHash: tx.refundTxHash as string | undefined,
    _type: 'deposit', bridgeSource: tx.bridgeSource as RecentTx['bridgeSource'], block_timestamp: tx.block_timestamp as string,
    externalChainId: (tx.externalChainId ?? info?.externalChainId) as string,
    externalSymbol: tx.externalSymbol as string, stratoTokenSymbol: tx.stratoTokenSymbol as string,
    amount: info?.stratoTokenAmount as string, status: info?.bridgeStatus as string,
    stratoToken: (info?.stratoToken ?? tx.stratoToken) as string,
    finalToken: tx.finalToken as string | undefined,
    depositOutcome: (type === 'pending'
      ? (tx.type === 'saving' ? 'save' : tx.type === 'forge' ? 'forge' : tx.type === 'route' ? 'route' : 'bridge')
      : tx.depositOutcome) as RecentTx['depositOutcome'],
    finalTokenSymbol: tx.finalTokenSymbol as string | undefined,
    finalAmount: tx.finalAmount as string | undefined,
  };
};

const mapWithdrawal = (tx: Record<string, unknown>): RecentTx => {
  const info = tx.WithdrawalInfo as Record<string, unknown> | undefined;
  return {
    withdrawalId: String(tx.withdrawalId ?? ''),
    sender: info?.stratoSender as string,
    externalTxHash: info?.externalTxHash as string,
    _type: 'withdrawal', bridgeSource: tx.bridgeSource as RecentTx['bridgeSource'], block_timestamp: tx.block_timestamp as string,
    externalChainId: (info?.externalChainId ?? tx.externalChainId) as string,
    externalSymbol: tx.externalSymbol as string, stratoTokenSymbol: tx.stratoTokenSymbol as string,
    amount: info?.stratoTokenAmount as string, status: info?.bridgeStatus as string,
    externalAmount: info?.externalTokenAmount as string, externalDecimals: tx.externalDecimals as number | undefined,
    stratoToken: (info?.stratoToken ?? tx.stratoToken) as string,
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
      const metadata = await resolveTokenMetadata([...collectMetalTokenAddrs(events)]);
      setTransactions(mapEventsToMetalTxs(events, metadata).map((tx) => ({
        ...tx, _type: 'metal' as const, amount: tx.metalAmount, amountDecimals: tx.metalDecimals, status: String(ExternalBridgeStatus.COMPLETED),
      })));
    } catch { setTransactions([]); }
    finally { setLoading(false); loadedRef.current = true; }
  }, [limit, isLoggedIn]);

  return { transactions, loading, load };
}

interface RecentTransactionsProps {
  fundingMode?: "bridge" | "metals";
  metalRefreshKey?: number;
  withdrawalsOnly?: boolean;
  includeRoutes?: boolean;
  routeRefreshKey?: number;
  networkOptions?: NetworkSummary[];
  routeTokens?: BridgeToken[];
}

const RecentTransactions = ({
  fundingMode = "bridge",
  metalRefreshKey = 0,
  includeRoutes = false,
  withdrawalsOnly = false,
  routeRefreshKey = 0,
  networkOptions,
  routeTokens,
}: RecentTransactionsProps) => {
  const { isLoggedIn, userAddress } = useUser();
  const {
    fetchDepositTransactions, fetchWithdrawTransactions,
    availableNetworks: bridgeNetworks, depositRefreshKey, withdrawalRefreshKey,
    bridgeableTokens: sharedBridgeTokens,
    pendingDepositsKey, triggerWithdrawalRefresh,
  } = useBridgeContext();
  const availableNetworks = networkOptions ?? bridgeNetworks;
  const bridgeableTokens = routeTokens ?? sharedBridgeTokens;

  const rebaseFactorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of bridgeableTokens) {
      if (t.rebaseFactor && t.stratoTokenSymbol) {
        map.set(t.stratoTokenSymbol, t.rebaseFactor);
      }
    }
    return map;
  }, [bridgeableTokens]);

  const chainNameMap = new Map(availableNetworks.map(n => [String(n.chainId), n.chainName]));
  const isMobile = useIsMobile();
  const recentLimit = withdrawalsOnly ? 5 : isMobile ? 6 : 8;

  const [bridgeError, setBridgeError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [bridgeTxs, setBridgeTxs] = useState<RecentTx[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const bridgeLoadedRef = useRef(false);

  const metal = useMetalTransactions(recentLimit, isLoggedIn);
  const [lastMetalRefreshKey, setLastMetalRefreshKey] = useState(-1);

  useEffect(() => {
    if (fundingMode !== "bridge") return;
    if (!isLoggedIn || ((includeRoutes || withdrawalsOnly) && !userAddress)) { setBridgeTxs([]); bridgeLoadedRef.current = true; return; }
    if (!bridgeLoadedRef.current) setBridgeLoading(true);
    let disposed = false, fetching = false;
    const load = () => {
      if (disposed || fetching) return;
      fetching = true;
      const params = { limit: String(recentLimit), offset: "0", order: "block_timestamp.desc" };
      Promise.all([
        withdrawalsOnly ? Promise.resolve({ data: [] }) : fetchDepositTransactions(params, "deposits"),
        includeRoutes
          ? Promise.resolve({ data: [] })
          : fetchWithdrawTransactions(params, "deposits"),
        includeRoutes
          ? activityFeedApi.getActivities(
              [{ contract_name: "TokenRouter", event_name: "RouteExecuted" }],
              { limit: recentLimit, myActivity: true }
            )
          : Promise.resolve({ events: [], total: 0 }),
      ]).then(async ([depositResult, withdrawalResult, routeResult]) => {
        if (disposed) return;
        const apiDeposits = (depositResult.data || []) as unknown as Record<string, unknown>[];
        let remaining = [];
        try { if (!withdrawalsOnly) ({ remaining } = mergePendingDeposits(apiDeposits, pendingDepositsKey)); }
        catch { /* Indexed history remains available when local storage is unavailable. */ }
        if (includeRoutes) remaining = remaining.filter(p => normalizeAddress(p.DepositInfo?.stratoRecipient) === normalizeAddress(userAddress));
        const routeEvents = routeResult.events || [];
        const all = [
          ...remaining.map((p: Record<string, unknown>) => mapDeposit(p, 'pending')),
          ...apiDeposits.map((tx) => mapDeposit(tx, 'api')),
          ...((withdrawalResult.data || []) as unknown as Record<string, unknown>[]).map(mapWithdrawal),
          ...routeEvents.map((event): RecentTx => ({
            _type: "route",
            block_timestamp: event.block_timestamp,
            amount: event.attributes.amountIn,
            stratoToken: event.attributes.tokenIn,
            finalAmount: event.attributes.amountOut,
            finalToken: event.attributes.tokenOut,
            status: String(ExternalBridgeStatus.COMPLETED),
          })),
        ].sort((a, b) => new Date(b.block_timestamp || 0).getTime() - new Date(a.block_timestamp || 0).getTime())
         .slice(0, recentLimit);
        const metadata = await resolveTokenMetadata(all.flatMap((tx) => [tx.stratoToken, tx.finalToken].filter(Boolean)));
        if (disposed) return;
        for (const tx of all) {
          const input = metadata.get(normalizeAddress(tx.stratoToken));
          const output = metadata.get(normalizeAddress(tx.finalToken));
          tx.amountDecimals = input?.customDecimals ?? 18;
          tx.finalDecimals = output?.customDecimals ?? 18;
          tx.stratoTokenSymbol = input?._symbol || tx.stratoTokenSymbol;
          tx.finalTokenSymbol = output?._symbol || tx.finalTokenSymbol;
        }
        setBridgeError(false);
        setBridgeTxs(all);
        setBridgeLoading(false);
        bridgeLoadedRef.current = true;
      }).catch(() => {
        if (disposed) return;
        setBridgeError(true);
        setBridgeLoading(false); bridgeLoadedRef.current = true;
      }).finally(() => { fetching = false; });
    };
    load();
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    const timer = (includeRoutes || withdrawalsOnly) ? window.setInterval(refresh, RECENT_TRANSACTIONS_REFRESH_MS) : undefined;
    if (includeRoutes || withdrawalsOnly) {
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearInterval(timer);
      if (includeRoutes || withdrawalsOnly) {
        window.removeEventListener("focus", refresh);
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, [retryKey, isLoggedIn, userAddress, fundingMode, fetchDepositTransactions, fetchWithdrawTransactions, depositRefreshKey, withdrawalRefreshKey, recentLimit, includeRoutes, withdrawalsOnly, routeRefreshKey, pendingDepositsKey]);

  if (fundingMode === "metals" && isLoggedIn && lastMetalRefreshKey !== metalRefreshKey) {
    setLastMetalRefreshKey(metalRefreshKey);
    metal.load();
  }

  const isBridge = fundingMode === "bridge";

  const computeRebasedAmount = (stratoAmount: string, stratoSymbol?: string): string | null => {
    const factor = rebaseFactorMap.get(stratoSymbol || '');
    if (!factor) return null;
    try {
      return (BigInt(stratoAmount) * BigInt(factor) / (10n ** 18n)).toString();
    } catch { return null; }
  };

  const renderTxRows = (txs: RecentTx[]) => (
    <div className="divide-y divide-border/40">
      {txs.map((tx, index) => {
        const amt = formatBalance(tx.amount || "0", undefined, tx.amountDecimals ?? 18, 2, 4);
        const key = `${tx.block_timestamp || "tx"}-${index}`;

        if (tx._type === 'metal') {
          return <TxRow key={key} icon={<Gem className="w-4 h-4 text-yellow-600" />} iconBg="bg-yellow-500/15"
            label="Metal Mint" status={METAL_STATUS} timeLabel={formatTimeAgo(tx.block_timestamp)}
            fromAmount={formatBalance(tx.payAmount || "0", undefined, tx.payDecimals ?? 18, 2, 4)} fromSymbol={tx.paySymbol || "-"}
            toAmount={amt} toSymbol={tx.metalSymbol || "-"} />;
        }
        if (tx._type === "route") {
          return <TxRow key={key} icon={<ArrowDown className="w-4 h-4 text-blue-500" />} iconBg="bg-blue-500/15"
            label="Trade" status={METAL_STATUS} timeLabel={formatTimeAgo(tx.block_timestamp)}
            fromAmount={amt} fromSymbol={tx.stratoTokenSymbol || "-"}
            toAmount={formatBalance(tx.finalAmount || "0", undefined, tx.finalDecimals ?? 18, 2, 4)} toSymbol={tx.finalTokenSymbol || "-"} />;
        }

        const isW = tx._type === 'withdrawal';
        const isFallback = !isW && tx.depositOutcome === "fallback";
        const isRouted = !isW && tx.depositOutcome === "route";
        const status: ReturnType<typeof getDepositStatusLabel> = {
          ...(isW ? getBridgeStatusLabel(tx.status, tx.bridgeSource) : getDepositStatusLabel(tx.status, tx.bridgeSource)),
          ...(isW && tx.bridgeSource !== "legacy" && { text: WITHDRAWAL_STATUS_LABELS[Number(tx.status)] || "Unknown" }),
          ...(withdrawalsOnly && tx.status === String(ExternalBridgeStatus.CANCELLATION_PENDING) && { description: "We’re checking whether your withdrawal can be canceled. No action is needed." }),
          ...(withdrawalsOnly && tx.bridgeSource === "external" && tx.status === String(ExternalBridgeStatus.REFUNDED) && { description: "Your tokens were returned to your STRATO wallet." }),
        };
        const hasOutcome = !isW && tx.depositOutcome && tx.depositOutcome !== "bridge" && tx.finalTokenSymbol;
        const rebasedExt = computeRebasedAmount(tx.amount || "0", tx.stratoTokenSymbol);
        const externalAmt = isW && tx.externalAmount && Number.isInteger(tx.externalDecimals)
          ? formatBalance(tx.externalAmount, undefined, tx.externalDecimals, 2, 4) : rebasedExt ? `≈ ${formatBalance(rebasedExt, undefined, 18, 2, 4)}` : amt;

        return <TxRow key={key}
          transactionUrl={withdrawalsOnly && tx.externalTxHash ? getExplorerUrl(String(tx.externalChainId), tx.externalTxHash) : undefined}
          action={withdrawalsOnly && ['external', 'native'].includes(tx.bridgeSource || '') && tx.withdrawalId &&
            normalizeAddress(tx.sender) === normalizeAddress(userAddress) && ['1', '2'].includes(tx.status || '')
            ? <WithdrawalCancellation source={tx.bridgeSource as 'external' | 'native'} withdrawalId={tx.withdrawalId} onCanceled={triggerWithdrawalRefresh} /> : undefined}
          refundUrl={tx.refundTxHash ? getExplorerUrl(String(tx.externalChainId), tx.refundTxHash) : undefined}
          icon={isW ? <ArrowUp className="w-4 h-4 text-amber-500" /> : <ArrowDown className="w-4 h-4 text-emerald-500" />}
          iconBg={isW ? "bg-amber-500/15" : "bg-emerald-500/15"}
          label={includeRoutes || withdrawalsOnly
            ? isW ? "Bridge Out" : isFallback ? "Bridge In (Fallback)" : isRouted ? "Bridge & Trade" : "Bridge In"
            : isW ? "Withdrawal" : isFallback ? "Deposit (Fallback)" : isRouted ? "Deposit & Trade" : "Deposit"} status={status}
          timeLabel={`${formatTimeAgo(tx.block_timestamp)} · ${chainNameMap.get(String(tx.externalChainId)) || "Unknown Chain"}`}
          fromAmount={isW ? amt : externalAmt} fromSymbol={(isW ? tx.stratoTokenSymbol : tx.externalSymbol) || "-"}
          toAmount={!isW && status.description ? "0" : hasOutcome && tx.finalAmount ? formatBalance(tx.finalAmount, undefined, tx.finalDecimals ?? 18, 2, 4) : (isW ? externalAmt : amt)}
          toSymbol={(hasOutcome ? tx.finalTokenSymbol : (isW ? tx.externalSymbol : tx.stratoTokenSymbol)) || "-"} />;
      })}
    </div>
  );

  const activeTxs = isBridge ? bridgeTxs : metal.transactions;
  const activeLoading = isBridge ? bridgeLoading : metal.loading;
  const viewAllLink = includeRoutes
    ? "/dashboard/activity"
    : isBridge
      ? "/bridge-transactions?from=deposits"
      : "/metal-transactions?from=deposits";
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
            {includeRoutes ? "Your activity" : isBridge ? "Recent Transactions" : "Recent Metal Purchases"}
          </CardTitle>
          {!withdrawalsOnly && <Link to={viewAllLink} className={linkClass}>
            View All {"\u2192"}
          </Link>}
        </div>

        {!isLoggedIn
          ? <p className="text-sm text-muted-foreground px-4 py-4">Sign in to view your recent activity.</p>
          : isBridge && bridgeError
            ? <div role="alert" className="p-4 text-sm text-destructive">
                <p>Unable to load recent activity. Please try again.</p>
                <Button variant="outline" className="mt-2" onClick={() => { setBridgeError(false); setBridgeLoading(true); setRetryKey(value => value + 1); }}>Retry</Button>
              </div>
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

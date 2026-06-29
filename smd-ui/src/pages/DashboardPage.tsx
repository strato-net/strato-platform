import { Activity, Box, FileText, Network, Server, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { BarSeriesCard, TxTypePieCard } from "@/components/dashboard/DashboardCharts";
import { PeersCard } from "@/components/dashboard/PeersCard";
import { RecentTransactionsCard } from "@/components/dashboard/RecentTransactionsCard";
import { CopyButton } from "@/components/CopyButton";
import { useMemo } from "react";
import { useSocketRoom } from "@/hooks/useSocketRoom";
import { ROOMS } from "@/lib/socket";
import { useNodeStatus, useNodeHealth, useNodeMetadata } from "@/services/dashboard";
import { useTransactions } from "@/services/explorer";
import { useUser } from "@/context/UserContext";
import { secondsToHuman, shortenHex } from "@/lib/utils";

interface HealthPayload {
  healthStatus?: string;
  health?: boolean;
  healthIssues?: string[];
}
interface SystemPayload {
  status?: boolean;
  warnings?: string;
  systemInfo?: {
    cpu?: { currentLoad?: { value?: number }; avgLoad?: { value?: number } };
    memory?: { use?: { value?: number } };
    filesystem?: { use?: { value?: number } }[];
  };
}
interface NetworkPayload {
  status?: boolean;
  statusMessage?: string;
}

function pct(v?: number) {
  return typeof v === "number" ? `${v.toFixed(1)}%` : "—";
}

export default function DashboardPage() {
  const lastBlock = useSocketRoom<number>(ROOMS.LAST_BLOCK_NUMBER, 0);
  const usersCount = useSocketRoom<number>(ROOMS.USERS_COUNT, 0);
  const contractsCount = useSocketRoom<number>(ROOMS.CONTRACTS_COUNT, 0);
  const uptime = useSocketRoom<number>(ROOMS.GET_NODE_UPTIME, 0);
  const health = useSocketRoom<HealthPayload>(ROOMS.GET_HEALTH, {});
  const system = useSocketRoom<SystemPayload>(ROOMS.GET_SYSTEM_INFO, {});
  const network = useSocketRoom<NetworkPayload>(ROOMS.GET_NETWORK_HEALTH, {});
  const txCount = useSocketRoom<{ x: number; y: number }[]>(ROOMS.TRANSACTIONS_COUNT, []);
  const blockProp = useSocketRoom<{ x: number; y: number }[]>(ROOMS.BLOCKS_PROPAGATION, []);

  // The series x values are relative indices; map them to real block numbers so the
  // bar tooltips show the actual block (newest bar = lastBlock).
  const txCountSeries = useMemo(() => attachBlockNumbers(txCount, lastBlock), [txCount, lastBlock]);
  const blockPropSeries = useMemo(
    () => attachBlockNumbers(blockProp, lastBlock),
    [blockProp, lastBlock]
  );

  // Transaction breakdown by function name (funcName), from recent transactions.
  const { data: recentTxs } = useTransactions(50);
  const txFnData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of recentTxs ?? []) {
      const name = (t.funcName || t.functionName)?.trim() || t.transactionType || "Unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [recentTxs]);

  // Transaction breakdown by sender (from address), from recent transactions.
  const txSenderData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of recentTxs ?? []) {
      const name = t.from ? shortenHex(t.from) : "Unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [recentTxs]);

  // /apex-api/status requires an authenticated session; skip the poll for guests and
  // fall back to the public /health endpoint for the health/version/uptime fields.
  const { isLoggedIn } = useUser();
  const { data: status } = useNodeStatus(isLoggedIn);
  const { data: nodeHealth } = useNodeHealth();
  const { data: metadata } = useNodeMetadata();
  const validators = metadata?.validators ?? [];
  const nodeAddress = status?.nodeAddress || nodeHealth?.nodeAddress || metadata?.nodeAddress;
  const version = status?.version || nodeHealth?.version;

  // Prefer the live socket values; fall back to /health (so guests still see health).
  const healthy = (health.health ?? nodeHealth?.health) !== false;
  const healthStatusText =
    health.healthStatus || nodeHealth?.healthStatus || (healthy ? "Healthy" : "Unhealthy");
  const uptimeSecs = uptime || nodeHealth?.uptime || 0;
  const issues =
    (health.healthIssues && health.healthIssues.length
      ? health.healthIssues
      : nodeHealth?.healthIssues) ?? [];
  const sys = system.systemInfo;
  const cpu = sys?.cpu?.currentLoad?.value;
  const mem = sys?.memory?.use?.value;
  const disk = sys?.filesystem?.[0]?.use?.value;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Live node and network statistics." />

      {/* Node status banner. Health/version/uptime come from /health (public) so guests
          see it too; detailed system metrics require an authenticated session. */}
      <Card>
        <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Node status
              <Badge variant={healthy ? "secondary" : "destructive"}>{healthStatusText}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Uptime {secondsToHuman(uptimeSecs)} · {version ? `v${version}` : "version —"}
            </CardDescription>
          </div>
          <div className="text-left text-xs text-muted-foreground sm:text-right">
            <div className="flex items-center justify-start gap-1.5 sm:justify-end">
              <Server className="h-3.5 w-3.5" />
              <span className="font-mono">{nodeAddress ? shortenHex(nodeAddress, 8, 6) : "—"}</span>
              {nodeAddress ? <CopyButton value={nodeAddress} /> : null}
            </div>
          </div>
        </CardHeader>
        {isLoggedIn || (!healthy && issues.length > 0) ? (
          <CardContent>
            {isLoggedIn ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric icon={Activity} label="CPU" value={pct(cpu)} />
                <Metric icon={Activity} label="Memory" value={pct(mem)} />
                <Metric icon={Activity} label="Disk" value={pct(disk)} />
                <Metric
                  icon={Network}
                  label="Network"
                  value={network.statusMessage || (network.status ? "Healthy" : "—")}
                />
              </div>
            ) : null}
            {!healthy && issues.length > 0 ? (
              <p className={isLoggedIn ? "mt-3 text-sm text-destructive" : "text-sm text-destructive"}>
                {issues.join(". ")}
              </p>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Last block" value={Number(lastBlock).toLocaleString()} icon={Box} />
        <StatCard label="Users" value={Number(usersCount).toLocaleString()} icon={Users} to="/accounts" />
        <StatCard label="Contracts" value={Number(contractsCount).toLocaleString()} icon={FileText} to="/contracts" />
      </div>

      {/* Peers + Recent transactions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PeersCard />
        <RecentTransactionsCard />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarSeriesCard title="Transactions per Last 15 Blocks" data={txCountSeries} seriesLabel="tx" />
        <TxTypePieCard title="Transactions by Function" data={txFnData} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TxTypePieCard title="Transactions by Sender" data={txSenderData} />
        <BarSeriesCard title="Block Interval (Last 15 Blocks)" data={blockPropSeries} unit="s" seriesLabel="s" />
      </div>

      {/* Validators */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validators ({validators.length})</CardTitle>
          <CardDescription>Current PBFT validator set.</CardDescription>
        </CardHeader>
        <CardContent>
          {validators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No validator data available.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {validators.map((v) => (
                <Badge key={v} variant="outline" className="font-mono text-xs">
                  {shortenHex(v, 8, 6)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Map a relative-index series ({x,y}) onto real block numbers. The last point is the
 * newest block (= lastBlock); earlier points count backwards. Falls back to the index
 * until lastBlock is known.
 */
function attachBlockNumbers(
  data: { x: number; y: number }[],
  lastBlock: number
): { x: number; y: number; block: number }[] {
  const len = data.length;
  return data.map((d, i) => ({
    ...d,
    block: lastBlock ? lastBlock - (len - 1 - i) : d.x,
  }));
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

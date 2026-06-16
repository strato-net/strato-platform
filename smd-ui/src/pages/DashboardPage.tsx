import { Activity, Box, Boxes, FileText, Network, Server, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/StatCard";
import { BarSeriesCard, TxTypePieCard } from "@/components/dashboard/DashboardCharts";
import { PeersCard } from "@/components/dashboard/PeersCard";
import { RecentTransactionsCard } from "@/components/dashboard/RecentTransactionsCard";
import { CopyButton } from "@/components/CopyButton";
import { useSocketRoom } from "@/hooks/useSocketRoom";
import { ROOMS } from "@/lib/socket";
import { useNodeStatus, useNodeMetadata } from "@/services/dashboard";
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
  const shardCount = useSocketRoom<number>(ROOMS.GET_SHARD_COUNT, 0);
  const uptime = useSocketRoom<number>(ROOMS.GET_NODE_UPTIME, 0);
  const health = useSocketRoom<HealthPayload>(ROOMS.GET_HEALTH, {});
  const system = useSocketRoom<SystemPayload>(ROOMS.GET_SYSTEM_INFO, {});
  const network = useSocketRoom<NetworkPayload>(ROOMS.GET_NETWORK_HEALTH, {});
  const txCount = useSocketRoom<{ x: number; y: number }[]>(ROOMS.TRANSACTIONS_COUNT, []);
  const blockProp = useSocketRoom<{ x: number; y: number }[]>(ROOMS.BLOCKS_PROPAGATION, []);
  const txTypes = useSocketRoom<{ val: number; type: string }[]>(ROOMS.TRANSACTIONS_TYPE, []);

  const { data: status } = useNodeStatus();
  const { data: metadata } = useNodeMetadata();
  const validators = metadata?.validators ?? [];
  const nodeAddress = status?.nodeAddress || metadata?.nodeAddress;

  const healthy = health.health !== false;
  const sys = system.systemInfo;
  const cpu = sys?.cpu?.currentLoad?.value;
  const mem = sys?.memory?.use?.value;
  const disk = sys?.filesystem?.[0]?.use?.value;

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Live node and network statistics." />

      {/* Node health banner */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              Node status
              <Badge variant={healthy ? "secondary" : "destructive"}>
                {health.healthStatus || (healthy ? "Healthy" : "Unhealthy")}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Uptime {secondsToHuman(uptime)} · {status?.version ? `v${status.version}` : "version —"}
            </CardDescription>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="flex items-center justify-end gap-1.5">
              <Server className="h-3.5 w-3.5" />
              <span className="font-mono">{nodeAddress ? shortenHex(nodeAddress, 8, 6) : "—"}</span>
              {nodeAddress ? <CopyButton value={nodeAddress} /> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
          {!healthy && health.healthIssues && health.healthIssues.length > 0 ? (
            <p className="mt-3 text-sm text-destructive">{health.healthIssues.join(". ")}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Last block" value={Number(lastBlock).toLocaleString()} icon={Box} />
        <StatCard label="Users" value={Number(usersCount).toLocaleString()} icon={Users} to="/accounts" />
        <StatCard label="Contracts" value={Number(contractsCount).toLocaleString()} icon={FileText} to="/contracts" />
        <StatCard label="Shards" value={Number(shardCount).toLocaleString()} icon={Boxes} />
      </div>

      {/* Peers + Recent transactions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PeersCard />
        <RecentTransactionsCard />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BarSeriesCard title="Transactions per Last 15 Blocks" data={txCount} />
        <TxTypePieCard data={txTypes} />
        <BarSeriesCard title="Block Interval (Last 15 Blocks)" data={blockProp} unit="s" />
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

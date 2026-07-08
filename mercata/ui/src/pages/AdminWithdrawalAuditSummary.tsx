import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  WithdrawalAuditDecision,
  WithdrawalAuditStepResult,
  WithdrawalAuditTrace,
  WithdrawalAuditTraceNode,
} from "@mercata/shared-types";
import { formatUnits } from "ethers";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TRACE_LOT_DISPLAY_LIMIT = 100;
const TOKEN_AMOUNT_DECIMALS = 18;

const decisionVariant = (decision?: WithdrawalAuditDecision): "default" | "secondary" | "destructive" | "outline" => {
  if (decision === "REJECT") return "destructive";
  if (decision === "MANUAL_REVIEW") return "secondary";
  return "default";
};

const resultClass = (result: WithdrawalAuditStepResult) => {
  if (result === "clean") return "text-green-700";
  if (result === "tainted") return "text-red-700";
  if (result === "unknown") return "text-yellow-700";
  return "text-muted-foreground";
};

const shortAddress = (value?: string) => {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const formatTokenAmount = (value?: string) => {
  if (!value) return "-";
  try {
    return formatUnits(value, TOKEN_AMOUNT_DECIMALS);
  } catch {
    return value;
  }
};

const formatEvidenceValue = (key: string, value: string) => {
  if (!value) return "-";
  return key.toLowerCase().includes("amount") ? formatTokenAmount(value) : value;
};

type TraceOmissionSummary = {
  totalNodes: number;
  totalLots: number;
  omittedNodes: number;
  omittedLots: number;
  omittedTrustAnchors: number;
  omittedClean: number;
  omittedTainted: number;
  omittedUnknown: number;
  omittedMaxDepth: number;
};

const emptyOmissionSummary = (): TraceOmissionSummary => ({
  totalNodes: 0,
  totalLots: 0,
  omittedNodes: 0,
  omittedLots: 0,
  omittedTrustAnchors: 0,
  omittedClean: 0,
  omittedTainted: 0,
  omittedUnknown: 0,
  omittedMaxDepth: 0,
});

const mergeSummary = (target: TraceOmissionSummary, source: TraceOmissionSummary) => {
  target.totalNodes += source.totalNodes;
  target.totalLots += source.totalLots;
  target.omittedNodes += source.omittedNodes;
  target.omittedLots += source.omittedLots;
  target.omittedTrustAnchors += source.omittedTrustAnchors;
  target.omittedClean += source.omittedClean;
  target.omittedTainted += source.omittedTainted;
  target.omittedUnknown += source.omittedUnknown;
  target.omittedMaxDepth += source.omittedMaxDepth;
};

const summarizeTraceTree = (
  node: WithdrawalAuditTraceNode,
  omitted = false,
): TraceOmissionSummary => {
  const summary = emptyOmissionSummary();
  summary.totalNodes = 1;
  if (node.type === "lot") summary.totalLots = 1;

  if (omitted) {
    summary.omittedNodes = 1;
    if (node.type === "lot") summary.omittedLots = 1;
    if (node.type === "trust_anchor") summary.omittedTrustAnchors = 1;
    if (node.type === "max_depth") summary.omittedMaxDepth = 1;
    if (node.result === "clean") summary.omittedClean = 1;
    if (node.result === "tainted") summary.omittedTainted = 1;
    if (node.result === "unknown") summary.omittedUnknown = 1;
  }

  for (const child of node.children) {
    mergeSummary(summary, summarizeTraceTree(child, omitted));
  }

  return summary;
};

const limitTraceTreeByLots = (
  node: WithdrawalAuditTraceNode,
  maxLots: number,
): { tree: WithdrawalAuditTraceNode | null; summary: TraceOmissionSummary } => {
  let renderedLots = 0;
  const summary = emptyOmissionSummary();

  const visit = (current: WithdrawalAuditTraceNode): WithdrawalAuditTraceNode | null => {
    if (current.type === "lot") {
      renderedLots += 1;
      if (renderedLots > maxLots) {
        mergeSummary(summary, summarizeTraceTree(current, true));
        return null;
      }
    }

    const children: WithdrawalAuditTraceNode[] = [];
    for (const child of current.children) {
      const limitedChild = visit(child);
      if (limitedChild) {
        children.push(limitedChild);
      }
    }

    return {
      ...current,
      children,
    };
  };

  const tree = visit(node);
  const totals = summarizeTraceTree(node);
  summary.totalNodes = totals.totalNodes;
  summary.totalLots = totals.totalLots;

  return { tree, summary };
};

const TraceOmissionNotice = ({ summary }: { summary: TraceOmissionSummary }) => {
  if (!summary.omittedLots) return null;

  const terminalDetails = [
    summary.omittedTrustAnchors > 0
      ? `${summary.omittedTrustAnchors} trust anchor node${summary.omittedTrustAnchors === 1 ? "" : "s"}`
      : "",
    summary.omittedClean > 0
      ? `${summary.omittedClean} clean node${summary.omittedClean === 1 ? "" : "s"}`
      : "",
    summary.omittedTainted > 0
      ? `${summary.omittedTainted} tainted node${summary.omittedTainted === 1 ? "" : "s"}`
      : "",
    summary.omittedUnknown > 0
      ? `${summary.omittedUnknown} unknown node${summary.omittedUnknown === 1 ? "" : "s"}`
      : "",
    summary.omittedMaxDepth > 0
      ? `${summary.omittedMaxDepth} max-depth stop${summary.omittedMaxDepth === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
      Showing the first {TRACE_LOT_DISPLAY_LIMIT} funding lots. Omitted {summary.omittedLots} of{" "}
      {summary.totalLots} lots ({summary.omittedNodes} trace nodes hidden).
      {terminalDetails.length > 0 && (
        <div className="mt-2">
          Omitted subtree summary: {terminalDetails.join(", ")}.
        </div>
      )}
    </div>
  );
};

const collectChildLots = (node: WithdrawalAuditTraceNode): WithdrawalAuditTraceNode[] => {
  const lots: WithdrawalAuditTraceNode[] = [];

  const visit = (children: WithdrawalAuditTraceNode[]) => {
    for (const child of children) {
      if (child.type === "lot") {
        lots.push(child);
      } else {
        visit(child.children);
      }
    }
  };

  visit(node.children);
  return lots;
};

const getTraceViewChildren = (node: WithdrawalAuditTraceNode) => {
  const childLots = collectChildLots(node);
  return childLots.length ? childLots : node.children;
};

const findTraceNode = (
  node: WithdrawalAuditTraceNode,
  nodeId: string,
): WithdrawalAuditTraceNode | null => {
  if (node.id === nodeId) return node;

  for (const child of node.children) {
    const match = findTraceNode(child, nodeId);
    if (match) return match;
  }

  return null;
};

const resolveTracePath = (
  tree: WithdrawalAuditTraceNode,
  pathIds: string[],
): WithdrawalAuditTraceNode[] => {
  const nodes: WithdrawalAuditTraceNode[] = [];

  for (const nodeId of pathIds) {
    const node = findTraceNode(tree, nodeId);
    if (!node) break;
    nodes.push(node);
  }

  return nodes;
};

const childActionLabel = (node: WithdrawalAuditTraceNode) => {
  const children = getTraceViewChildren(node);
  const lotCount = children.filter((child) => child.type === "lot").length;
  if (lotCount) return `View ${lotCount} child lot${lotCount === 1 ? "" : "s"}`;
  if (children.length) return `View ${children.length} trace detail${children.length === 1 ? "" : "s"}`;
  return "";
};

const TraceNodeCard = ({
  node,
  onOpen,
}: {
  node: WithdrawalAuditTraceNode;
  onOpen?: () => void;
}) => {
  const content = (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{node.label}</div>
        <span className={`text-sm font-semibold uppercase ${resultClass(node.result)}`}>
          {node.result}
        </span>
      </div>
      <p className="mb-3 text-sm text-foreground">{node.explanation}</p>
      <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        {node.actor && <div>Actor: {node.actor}</div>}
        {node.token && <div>Token: {node.token}</div>}
        {node.amount && <div>Amount: {formatTokenAmount(node.amount)}</div>}
        {Object.entries(node.evidence || {}).map(([key, value]) => (
          <div key={key}>
            {key}: {formatEvidenceValue(key, value)}
          </div>
        ))}
      </div>
      {onOpen && (
        <div className="mt-3 text-xs font-medium text-primary">
          {childActionLabel(node)}
        </div>
      )}
    </>
  );

  if (!onOpen) {
    return <div className="rounded-lg border border-border p-4">{content}</div>;
  }

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border p-4 text-left transition hover:bg-muted/40"
      onClick={onOpen}
    >
      {content}
    </button>
  );
};

const TraceLotNavigator = ({ tree }: { tree: WithdrawalAuditTraceNode }) => {
  const [activePathIds, setActivePathIds] = useState<string[]>([]);
  const activePath = useMemo(
    () => resolveTracePath(tree, activePathIds),
    [tree, activePathIds],
  );
  const isShowingChildren = activePath.length > 0 && activePath.length === activePathIds.length;
  const currentNode = isShowingChildren ? activePath[activePath.length - 1] : tree;
  const visibleNodes = isShowingChildren ? getTraceViewChildren(currentNode) : [tree];
  const visibleLotCount = visibleNodes.filter((node) => node.type === "lot").length;
  const currentPathIds = isShowingChildren ? activePathIds : [];
  const backLabel = currentPathIds.length === 1 ? "Back to withdrawal request" : "Back to parent lot";

  const openNode = (node: WithdrawalAuditTraceNode) => {
    if (!getTraceViewChildren(node).length) return;
    setActivePathIds([...currentPathIds, node.id]);
  };

  return (
    <div className="space-y-4">
      {isShowingChildren && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Children of {currentNode.label}</p>
            <p className="text-xs text-muted-foreground">
              {visibleLotCount
                ? "Select a child lot to inspect its funding lots."
                : "Review terminal trace details for this lot."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActivePathIds(currentPathIds.slice(0, -1))}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {visibleNodes.map((node) => {
          const hasChildren = getTraceViewChildren(node).length > 0;
          return (
            <TraceNodeCard
              key={node.id}
              node={node}
              onOpen={hasChildren ? () => openNode(node) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
};

const AdminWithdrawalAuditSummary = () => {
  const navigate = useNavigate();
  const { routeType, withdrawalId } = useParams();
  const [trace, setTrace] = useState<WithdrawalAuditTrace | null>(null);
  const [loading, setLoading] = useState(false);

  const isPending = trace?.status === "queued" || trace?.status === "running";

  const loadTrace = useCallback(async () => {
    if (!routeType || !withdrawalId) return;
    setLoading(true);
    try {
      const { data } = await api.get<WithdrawalAuditTrace>(
        `/bridge/withdrawal-audits/${routeType}/${withdrawalId}`,
      );
      setTrace(data);
    } finally {
      setLoading(false);
    }
  }, [routeType, withdrawalId]);

  useEffect(() => {
    loadTrace();
  }, [loadTrace]);

  useEffect(() => {
    if (!isPending) return;
    const id = window.setInterval(loadTrace, 3000);
    return () => window.clearInterval(id);
  }, [isPending, loadTrace]);

  const withdrawal = trace?.withdrawal;
  const coverageRows = useMemo(() => {
    if (!trace?.coverage) return [];
    return [
      ["Clean", trace.coverage.clean],
      ["Tainted", trace.coverage.tainted],
      ["Unknown", trace.coverage.unknown],
    ];
  }, [trace?.coverage]);
  const limitedTrace = useMemo(() => {
    if (!trace?.traceTree) return null;
    return limitTraceTreeByLots(trace.traceTree, TRACE_LOT_DISPLAY_LIMIT);
  }, [trace?.traceTree]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="container mx-auto flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/admin")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-xl font-bold">Withdrawal Audit Summary</h1>
            <p className="text-sm text-muted-foreground">
              {routeType}:{withdrawalId}
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {!trace && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {loading ? "Loading audit trace..." : "Audit trace not found."}
            </CardContent>
          </Card>
        )}

        {trace && withdrawal && (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Decision</CardTitle>
                    <CardDescription>
                      Backend WAS status: {trace.status}
                      {trace.maxDepth ? ` (max depth ${trace.maxDepth})` : " (full depth)"}
                    </CardDescription>
                  </div>
                  <Badge variant={decisionVariant(trace.decision)}>
                    {trace.decision || trace.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Withdrawer</p>
                  <p className="font-medium">{shortAddress(withdrawal.stratoSender)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Requested Amount</p>
                  <p className="font-medium">
                    {formatTokenAmount(withdrawal.stratoTokenAmount || "0")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Recipient</p>
                  <p className="font-medium">{shortAddress(withdrawal.externalRecipient)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Coverage</CardTitle>
                <CardDescription>Amount coverage by provenance classification.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {coverageRows.map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border p-4">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{formatTokenAmount(value)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  {trace.stoppedEarly && (
                    <li className="text-yellow-700">
                      Trace stopped before the full depth completed.
                    </li>
                  )}
                  {trace.summary.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                  {trace.error && <li className="text-red-700">{trace.error}</li>}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trace</CardTitle>
                <CardDescription>Tree of funding evidence used by the POC WAS.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {limitedTrace?.tree ? (
                  <>
                    <TraceOmissionNotice summary={limitedTrace.summary} />
                    <TraceLotNavigator tree={limitedTrace.tree} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isPending ? "Trace is still running." : "No trace tree available."}
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminWithdrawalAuditSummary;

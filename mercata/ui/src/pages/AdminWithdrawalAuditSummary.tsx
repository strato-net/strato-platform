import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  WithdrawalAuditDecision,
  WithdrawalAuditStepResult,
  WithdrawalAuditTrace,
  WithdrawalAuditTraceNode,
} from "@mercata/shared-types";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/axios";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatWeiToDecimalHP } from "@/utils/numberUtils";

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

const TraceTreeNode = ({ node, depth = 0 }: { node: WithdrawalAuditTraceNode; depth?: number }) => (
  <div className="space-y-3">
    <div className="rounded-lg border border-border p-4" style={{ marginLeft: depth ? 16 : 0 }}>
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
        {node.amount && <div>Amount: {node.amount}</div>}
        {Object.entries(node.evidence || {}).map(([key, value]) => (
          <div key={key}>
            {key}: {value || "-"}
          </div>
        ))}
      </div>
    </div>
    {node.children.map((child) => (
      <TraceTreeNode key={child.id} node={child} depth={depth + 1} />
    ))}
  </div>
);

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
        `/bridge/withdrawal-audits/${routeType}/${withdrawalId}?maxDepth=5`,
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
                      {trace.maxDepth ? ` (max depth ${trace.maxDepth})` : ""}
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
                    {formatWeiToDecimalHP(withdrawal.stratoTokenAmount || "0", 18)}
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
                    <p className="text-lg font-semibold">{formatWeiToDecimalHP(value, 18)}</p>
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
                      Quick run stopped before the full trace completed.
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
                {trace.traceTree ? (
                  <TraceTreeNode node={trace.traceTree} />
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

import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { formatEther } from "viem";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTransactionByHash } from "@/services/explorer";
import { DetailRow } from "@/components/explorer/DetailRow";
import { formatTimestamp } from "@/lib/utils";

function fmtValue(v?: string | number): string {
  if (v == null) return "0";
  try {
    return `${formatEther(BigInt(v))} (${v} wei)`;
  } catch {
    return String(v);
  }
}

export default function TransactionDetailPage() {
  const { hash } = useParams();
  const navigate = useNavigate();
  const { data: tx, isLoading } = useTransactionByHash(hash);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction"
        actions={
          <Button variant="outline" onClick={() => navigate("/explorer")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction details</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : !tx ? (
            <p className="text-sm text-muted-foreground">Transaction not found.</p>
          ) : (
            <dl className="divide-y divide-border">
              <DetailRow label="Hash" value={tx.hash || hash || "—"} mono />
              <DetailRow label="Type" value={tx.transactionType || "—"} />
              <DetailRow label="From" value={tx.from || "—"} mono />
              <DetailRow label="To" value={tx.to || "—"} mono />
              <DetailRow label="Value" value={fmtValue(tx.value)} />
              <DetailRow label="Nonce" value={String(tx.nonce ?? "—")} />
              <DetailRow label="Gas limit" value={String(tx.gasLimit ?? "—")} />
              <DetailRow label="Gas price" value={String(tx.gasPrice ?? "—")} />
              <DetailRow label="Block" value={String(tx.blockNumber ?? "—")} />
              <DetailRow label="Timestamp" value={formatTimestamp(tx.timestamp)} />
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBlockByNumber } from "@/services/explorer";
import { DetailRow } from "@/components/explorer/DetailRow";
import { shortenHex, formatTimestamp } from "@/lib/utils";

export default function BlockDetailPage() {
  const { number } = useParams();
  const navigate = useNavigate();
  const { data: block, isLoading } = useBlockByNumber(number);

  const bd = block?.blockData;
  const txns = block?.receiptTransactions || block?.transactions || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Block #${number}`}
        actions={
          <Button variant="outline" onClick={() => navigate("/explorer")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Block details</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : !block ? (
            <p className="text-sm text-muted-foreground">Block not found.</p>
          ) : (
            <dl className="divide-y divide-border">
              <DetailRow label="Number" value={String(bd?.number ?? "—")} />
              <DetailRow label="Hash" value={block.blockHash || block.hash || bd?.hash || "—"} mono />
              <DetailRow label="Parent hash" value={bd?.parentHash || "—"} mono />
              <DetailRow label="Timestamp" value={formatTimestamp(bd?.timestamp)} />
              <DetailRow label="Difficulty" value={String(bd?.difficulty ?? "—")} />
              <DetailRow label="Nonce" value={bd?.nonce || "—"} mono />
              <DetailRow label="Gas used" value={String(bd?.gasUsed ?? "—")} />
              <DetailRow label="Transactions" value={String(txns.length)} />
            </dl>
          )}
        </CardContent>
      </Card>

      {txns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transactions ({txns.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hash</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((t, i) => (
                  <TableRow key={`${t.hash}-${i}`}>
                    <TableCell className="font-mono text-xs">
                      {t.hash ? (
                        <Link to={`/explorer/transactions/${t.hash}`} className="text-primary hover:underline">
                          {shortenHex(t.hash)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{t.transactionType || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{shortenHex(t.from || "")}</TableCell>
                    <TableCell className="font-mono text-xs">{t.to ? shortenHex(t.to) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

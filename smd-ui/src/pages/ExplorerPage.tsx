import { useNavigate } from "react-router-dom";
import { formatEther } from "viem";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBlocks, useTransactions } from "@/services/explorer";
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { shortenHex, formatTimestamp } from "@/lib/utils";

function fmtValue(v?: string | number): string {
  if (v == null) return "0";
  try {
    return `${Number(formatEther(BigInt(v))).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
  } catch {
    return String(v);
  }
}

function BlocksTable() {
  const navigate = useNavigate();
  const { data: blocks, isLoading } = useBlocks(15);

  if (isLoading) return <TableSkeleton />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Block</TableHead>
          <TableHead>Txns</TableHead>
          <TableHead>Difficulty</TableHead>
          <TableHead>Timestamp</TableHead>
          <TableHead>Parent hash</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(blocks ?? []).map((b, i) => {
          const num = b.blockData?.number;
          const txns = (b.receiptTransactions || b.transactions || []).length;
          return (
            <TableRow
              key={`${num}-${i}`}
              className="cursor-pointer"
              onClick={() => num != null && navigate(`/explorer/blocks/${num}`)}
            >
              <TableCell className="font-medium">{num ?? "—"}</TableCell>
              <TableCell>{txns}</TableCell>
              <TableCell>{String(b.blockData?.difficulty ?? "—")}</TableCell>
              <TableCell className="text-muted-foreground">{formatTimestamp(b.blockData?.timestamp)}</TableCell>
              <TableCell className="font-mono text-xs">{shortenHex(b.blockData?.parentHash || "")}</TableCell>
            </TableRow>
          );
        })}
        {(blocks ?? []).length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">No blocks.</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function TransactionsTable() {
  const navigate = useNavigate();
  const { data: txns, isLoading } = useTransactions(15);

  if (isLoading) return <TableSkeleton />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Hash</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(txns ?? []).map((t, i) => (
          <TableRow
            key={`${t.hash}-${i}`}
            className="cursor-pointer"
            onClick={() => t.hash && navigate(`/explorer/transactions/${t.hash}`)}
          >
            <TableCell className="font-mono text-xs">{shortenHex(t.hash || "")}</TableCell>
            <TableCell>
              <Badge variant="outline">{t.transactionType || "—"}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs">{shortenHex(t.from || "")}</TableCell>
            <TableCell className="font-mono text-xs">{t.to ? shortenHex(t.to) : "—"}</TableCell>
            <TableCell className="text-right">{fmtValue(t.value)}</TableCell>
          </TableRow>
        ))}
        {(txns ?? []).length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">No transactions.</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Explorer"
        description="Browse recent blocks and transactions, or search by block, hash, or account."
        actions={<ExplorerSearch />}
      />
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="blocks">
            <TabsList>
              <TabsTrigger value="blocks">Blocks</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
            </TabsList>
            <TabsContent value="blocks" className="mt-4">
              <BlocksTable />
            </TabsContent>
            <TabsContent value="transactions" className="mt-4">
              <TransactionsTable />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

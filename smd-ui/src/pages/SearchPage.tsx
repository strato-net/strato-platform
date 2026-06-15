import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, FileText, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
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
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { searchAccounts, classifyQuery } from "@/services/explorer";
import { shortenHex } from "@/lib/utils";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const kind = classifyQuery(q);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["search-accounts", q],
    enabled: !!q,
    queryFn: () => searchAccounts(q),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Search" description={q ? `Results for "${q}"` : "Search the network."} actions={<ExplorerSearch />} />

      {/* Direct-match shortcuts */}
      {kind === "block" ? (
        <ShortcutCard icon={Box} title={`Block #${q}`} to={`/explorer/blocks/${q}`} />
      ) : null}
      {kind === "hash" ? (
        <ShortcutCard icon={FileText} title="Transaction by hash" to={`/explorer/transactions/${q.startsWith("0x") ? q : `0x${q}`}`} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!q ? (
            <p className="text-sm text-muted-foreground">Enter a search term.</p>
          ) : isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (accounts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching accounts.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Common name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts ?? []).map((a) => (
                  <TableRow key={a.userAddress}>
                    <TableCell className="font-medium">{a.commonName}</TableCell>
                    <TableCell className="text-muted-foreground">{a.organization || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{shortenHex(a.userAddress)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ShortcutCard({
  icon: Icon,
  title,
  to,
}: {
  icon: typeof Box;
  title: string;
  to: string;
}) {
  return (
    <Link to={to}>
      <Card className="transition-colors hover:border-primary/50">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="rounded-lg bg-muted p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <span className="font-medium">{title}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, FileText, Users, Database, Wallet } from "lucide-react";
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
import { ExplorerSearch } from "@/components/explorer/ExplorerSearch";
import { AddrLink } from "@/components/explorer/AddrLink";
import {
  searchTransactions,
  searchStratoAccounts,
  searchStorage,
  searchBlocks,
  classifyQuery,
  stripHexPrefix,
  useBlockByNumber,
  type Block,
} from "@/services/explorer";
import { searchUsers } from "@/services/accounts";
import { shortenHex } from "@/lib/utils";

const PAGE = 5;

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get("q") || "").trim();
  // strato-api `search` param wants hex without the 0x prefix.
  const cleaned = stripHexPrefix(q);
  const isBlockNum = classifyQuery(q) === "block";

  // Users — same User-contract logic as the Accounts tab, filtered by username.
  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["search-users", q],
    enabled: !!q,
    queryFn: () => searchUsers(q),
  });

  // Accounts / Storage / Transactions — strato-api `search` param (%term%).
  const { data: accounts, isLoading: accLoading } = useQuery({
    queryKey: ["search-strato-accounts", cleaned],
    enabled: !!q,
    queryFn: () => searchStratoAccounts(cleaned),
  });
  const { data: storage, isLoading: storageLoading } = useQuery({
    queryKey: ["search-storage", cleaned],
    enabled: !!q,
    queryFn: () => searchStorage(cleaned),
  });
  const { data: txnSearch, isLoading: txnsLoading } = useQuery({
    queryKey: ["search-transactions", cleaned],
    enabled: !!q,
    queryFn: () => searchTransactions(cleaned),
  });
  const { data: blockSearch, isLoading: blockSearchLoading } = useQuery({
    queryKey: ["search-blocks", cleaned],
    enabled: !!q,
    queryFn: () => searchBlocks(cleaned),
  });

  // A bare block number isn't matched by the block `search` param, so resolve it
  // exactly by number (the only non-search lookup we still need).
  const { data: blockByNum, isLoading: blockNumLoading } = useBlockByNumber(
    isBlockNum ? q : undefined
  );

  const txns = txnSearch ?? [];

  // Blocks: search results (hash/coinbase) plus an exact by-number match, deduped.
  const blocks: Block[] = (() => {
    const list: Block[] = [];
    const seen = new Set<string>();
    const add = (b?: Block | null) => {
      if (!b) return;
      const key = b.blockHash || String(b.blockData?.number ?? "");
      if (seen.has(key)) return;
      seen.add(key);
      list.push(b);
    };
    add(blockByNum);
    (blockSearch ?? []).forEach(add);
    return list;
  })();

  const hasQuery = !!q;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description={q ? `Results for "${q}"` : "Search the network."}
        actions={<ExplorerSearch />}
      />

      <SearchPanel
        icon={Users}
        title="Users"
        headers={["Username", "Address"]}
        loading={usersLoading}
        hasQuery={hasQuery}
        rows={(users ?? []).map((u) => (
          <TableRow key={u.address}>
            <TableCell className="font-medium">{u.username}</TableCell>
            <TableCell className="font-mono text-xs">
              <AddrLink address={u.address} />
            </TableCell>
          </TableRow>
        ))}
      />

      <SearchPanel
        icon={Wallet}
        title="Accounts"
        headers={["Address", "Contract", "Balance (wei)", "Nonce"]}
        loading={accLoading}
        hasQuery={hasQuery}
        rows={(accounts ?? []).map((a, i) => (
          <TableRow key={`${a.address}-${i}`}>
            <TableCell className="font-mono text-xs">
              <AddrLink address={a.address} />
            </TableCell>
            <TableCell>{a.contractName || "—"}</TableCell>
            <TableCell className="font-mono text-xs">{String(a.balance ?? "0")}</TableCell>
            <TableCell>{String(a.nonce ?? "—")}</TableCell>
          </TableRow>
        ))}
      />

      <SearchPanel
        icon={Database}
        title="Storage"
        headers={["Address", "Key", "Value"]}
        loading={storageLoading}
        hasQuery={hasQuery}
        rows={(storage ?? []).map((s, i) => (
          <TableRow key={`${s.address}-${s.key}-${i}`}>
            <TableCell className="font-mono text-xs">
              <AddrLink address={s.address} />
            </TableCell>
            <TableCell className="max-w-[12rem] truncate font-mono text-xs" title={s.key}>
              {s.key || "—"}
            </TableCell>
            <TableCell className="max-w-[24rem] truncate text-xs" title={s.value}>
              {s.value || "—"}
            </TableCell>
          </TableRow>
        ))}
      />

      <SearchPanel
        icon={FileText}
        title="Transactions"
        headers={["Hash", "Type", "From", "To", "Block"]}
        loading={txnsLoading}
        hasQuery={hasQuery}
        rows={txns.map((t, i) => (
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
            <TableCell className="font-mono text-xs">
              <AddrLink address={t.from} />
            </TableCell>
            <TableCell className="font-mono text-xs">
              <AddrLink address={t.to} />
            </TableCell>
            <TableCell>
              {t.blockNumber != null ? (
                <Link to={`/explorer/blocks/${t.blockNumber}`} className="text-primary hover:underline">
                  {String(t.blockNumber)}
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
          </TableRow>
        ))}
      />

      <SearchPanel
        icon={Box}
        title="Blocks"
        headers={["Number", "Hash", "Transactions"]}
        loading={blockNumLoading || blockSearchLoading}
        hasQuery={hasQuery}
        rows={blocks.map((b, i) => {
          const num = b.blockData?.number;
          const txCount = (b.receiptTransactions || b.transactions || []).length;
          return (
            <TableRow key={`${b.blockHash}-${i}`}>
              <TableCell>
                {num != null ? (
                  <Link to={`/explorer/blocks/${num}`} className="text-primary hover:underline">
                    {String(num)}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="max-w-[20rem] truncate font-mono text-xs" title={b.blockHash}>
                {b.blockHash ? shortenHex(b.blockHash) : "—"}
              </TableCell>
              <TableCell>{txCount}</TableCell>
            </TableRow>
          );
        })}
      />
    </div>
  );
}

function SearchPanel({
  icon: Icon,
  title,
  headers,
  rows,
  loading,
  hasQuery,
}: {
  icon: typeof Box;
  title: string;
  headers: string[];
  rows: React.ReactNode[];
  loading: boolean;
  hasQuery: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, PAGE);

  // Hide the panel entirely when there's nothing to show (no query, or a query
  // that returned no results). Only render while loading or when there are rows.
  if (!hasQuery) return null;
  if (!loading && rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" /> {title}
          {!loading && rows.length > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>{shown}</TableBody>
            </Table>
            {rows.length > PAGE ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? "Show less" : `Show all ${rows.length}`}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

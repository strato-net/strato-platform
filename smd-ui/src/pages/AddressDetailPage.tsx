import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { formatEther } from "viem";
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
import { CopyButton } from "@/components/CopyButton";
import { DetailRow } from "@/components/explorer/DetailRow";
import { AddrLink } from "@/components/explorer/AddrLink";
import { ContractStatePanel } from "@/components/contracts/ContractStatePanel";
import { useAccountDetail } from "@/services/accounts";
import { useStorageByAddress, useTransactionsByAddress } from "@/services/explorer";
import { shortenHex } from "@/lib/utils";

function formatBalance(balance?: string): string {
  if (!balance) return "0";
  try {
    return `${Number(formatEther(BigInt(balance))).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    })} STRATO`;
  } catch {
    return balance;
  }
}

export default function AddressDetailPage() {
  const { address } = useParams();
  const navigate = useNavigate();
  const { data: account, isLoading: accountLoading } = useAccountDetail(address);
  const { data: storage, isLoading: storageLoading } = useStorageByAddress(address);
  const { data: txns, isLoading: txnsLoading } = useTransactionsByAddress(address);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Address"
        actions={
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent>
          {accountLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : (
            <dl className="divide-y divide-border">
              <DetailRow
                label="Address"
                mono
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {address || "—"}
                    {address ? <CopyButton value={address} /> : null}
                  </span>
                }
              />
              <DetailRow label="Balance" value={formatBalance(account?.balance)} />
              <DetailRow label="Nonce" value={String(account?.nonce ?? 0)} />
              {account?.contractName ? (
                <DetailRow label="Contract" value={account.contractName} />
              ) : null}
              {account?.codeHash ? (
                <DetailRow label="Code hash" value={account.codeHash} mono />
              ) : null}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Contract state + callable functions (only when this address is a contract) */}
      {account?.contractName && address ? (
        <ContractStatePanel name={account.contractName} address={address} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Transactions {txns?.length ? `(${txns.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {txnsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (txns ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hash</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Block</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(txns ?? []).slice(0, 100).map((t, i) => (
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
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Storage {storage?.length ? `(${storage.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {storageLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (storage ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No storage entries.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(storage ?? []).slice(0, 200).map((s, i) => (
                  <TableRow key={`${s.key}-${i}`}>
                    <TableCell className="max-w-[16rem] truncate font-mono text-xs" title={s.key}>
                      {s.key || "—"}
                    </TableCell>
                    <TableCell className="max-w-[28rem] truncate text-xs" title={s.value}>
                      {s.value || "—"}
                    </TableCell>
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

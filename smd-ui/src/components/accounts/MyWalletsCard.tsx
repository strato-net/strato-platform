import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddrLink } from "@/components/explorer/AddrLink";
import { WalletPolicyDialog } from "@/components/accounts/WalletPolicyDialog";
import { DedicatedMultisigDialog } from "@/components/accounts/DedicatedMultisigDialog";
import { useMyUserWallets } from "@/services/userWallets";

/** Lists User wallets and dedicated multisigs associated with the connected account. */
export function MyWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const { data: wallets, isLoading } = useMyUserWallets(ownerAddress);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>My wallets</CardTitle>
            <CardDescription>
              User wallets and factory-created dedicated multisigs associated with this account.
            </CardDescription>
          </div>
          <DedicatedMultisigDialog />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Wallet address</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(wallets ?? []).map((w) => (
                <TableRow key={w.address}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {w.username || (w.factoryMultisig ? "Dedicated multisig" : "—")}
                      {w.pendingSigner ? (
                        <Badge variant="outline" className="text-[10px]">
                          Pending signer
                        </Badge>
                      ) : w.factoryMultisig ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Factory-created
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <AddrLink address={w.address} />
                      <CopyButton value={w.address} />
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {w.factoryMultisig ? <DedicatedMultisigDialog wallet={w} /> : null}
                      {!w.pendingSigner && !w.factoryMultisig ? <WalletPolicyDialog wallet={w} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(wallets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No wallets yet. Create a User wallet or a dedicated multisig.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

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
import { MultisigDialog } from "@/components/accounts/MultisigDialog";
import { useMyUserWallets } from "@/services/userWallets";
import { useNestedMultisigs, multisigDisplayName } from "@/services/multisig";
import { shortenHex } from "@/lib/utils";

/** Lists the User wallet contracts the connected account is authorized on. */
export function MyWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const { data: wallets, isLoading } = useMyUserWallets(ownerAddress);
  const { data: nested = [] } = useNestedMultisigs(wallets);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My User wallets</CardTitle>
        <CardDescription>
          User wallet contracts your connected account controls or is a multisig signer on.
          Manage each wallet's policy or multisig below.
        </CardDescription>
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
                <TableHead>Username</TableHead>
                <TableHead>Wallet address</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(wallets ?? []).map((w) => (
                <TableRow key={w.address}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {w.username || "—"}
                      {w.multisig ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Multisig
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
                      <MultisigDialog wallet={w} />
                      <WalletPolicyDialog wallet={w} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(wallets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No User wallets yet. Use "Create User" to make one.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}

        {nested.length > 0 ? (
          <div className="mt-6">
            <div className="text-sm font-medium">Multisigs via membership</div>
            <p className="mb-2 text-xs text-muted-foreground">
              Multisigs you can vote in because a multisig you sign is itself a signer
              there. Votes pass through each multisig on the way.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead className="text-right">Manage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nested.map((m) => (
                  <TableRow key={m.wallet.address}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {multisigDisplayName(m.wallet) || shortenHex(m.wallet.address, 6, 4)}
                        <Badge variant="secondary" className="text-[10px]">
                          Nested
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <AddrLink address={m.wallet.address} />
                        <CopyButton value={m.wallet.address} />
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {m.route
                        .slice(0, -1)
                        .map((w) => multisigDisplayName(w) || shortenHex(w.address, 4, 4))
                        .join(" → ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <MultisigDialog wallet={m.wallet} route={m.route} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

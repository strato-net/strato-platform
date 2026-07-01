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
import { CopyButton } from "@/components/CopyButton";
import { AddrLink } from "@/components/explorer/AddrLink";
import { WalletPolicyDialog } from "@/components/accounts/WalletPolicyDialog";
import { MultisigDialog } from "@/components/accounts/MultisigDialog";
import { useMyUserWallets } from "@/services/userWallets";

/** Lists the User wallet contracts the connected account is authorized on. */
export function MyWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const { data: wallets, isLoading } = useMyUserWallets(ownerAddress);

  return (
    <Card>
      <CardHeader>
        <CardTitle>My User wallets</CardTitle>
        <CardDescription>
          User wallet contracts your connected account controls. Manage each wallet's policy
          (logic contract) below.
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
                  <TableCell className="font-medium">{w.username || "—"}</TableCell>
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
      </CardContent>
    </Card>
  );
}

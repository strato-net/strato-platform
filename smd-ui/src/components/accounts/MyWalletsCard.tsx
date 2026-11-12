import { Link } from "react-router-dom";
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
import { CreateUserDialog } from "@/components/accounts/CreateUserDialog";
import { WalletPolicyDialog } from "@/components/accounts/WalletPolicyDialog";
import { useMyUserWallets } from "@/services/userWallets";

/** Lists User wallets controlled by the connected account. */
export function MyWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const { data: wallets, isLoading } = useMyUserWallets(ownerAddress);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>My User wallets</CardTitle>
            <CardDescription>User wallets controlled by your connected account.</CardDescription>
          </div>
          <CreateUserDialog />
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
                <TableHead>Username</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Policy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(wallets ?? []).map((w) => (
                <TableRow key={w.address}>
                  <TableCell className="font-medium">{w.username}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <AddrLink address={w.address} />
                      <CopyButton value={w.address} />
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <WalletPolicyDialog wallet={w} />
                  </TableCell>
                </TableRow>
              ))}
              {(wallets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No User wallets yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
        <Link to="/accounts/users" className="mt-4 inline-block text-sm text-primary hover:underline">
          All User wallets →
        </Link>
      </CardContent>
    </Card>
  );
}

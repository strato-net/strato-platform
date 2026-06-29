import { formatEther } from "viem";
import { PageHeader } from "@/components/PageHeader";
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
import { Button } from "@/components/ui/button";
import { SendTokensDialog } from "@/components/accounts/SendTokensDialog";
import { CreateUserDialog } from "@/components/accounts/CreateUserDialog";
import { MyWalletsCard } from "@/components/accounts/MyWalletsCard";
import { CopyButton } from "@/components/CopyButton";
import { useUser } from "@/context/UserContext";
import { useAccountDetail, useUsers } from "@/services/accounts";
import { requestWalletConnection } from "@/lib/auth";
import { shortenHex } from "@/lib/utils";

function formatBalance(balance?: string): string {
  if (!balance) return "0";
  try {
    return Number(formatEther(BigInt(balance))).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  } catch {
    return balance;
  }
}

export default function AccountsPage() {
  const { userAddress } = useUser();
  const { data: account, isLoading: accountLoading } = useAccountDetail(userAddress);
  const { data: users, isLoading: usersLoading } = useUsers();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="View balances and send tokens across STRATO accounts."
        actions={
          userAddress ? (
            <div className="flex items-center gap-2">
              <CreateUserDialog />
              <SendTokensDialog />
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Connected account</CardTitle>
          <CardDescription>The wallet currently connected to the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          {!userAddress ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">No wallet connected.</p>
              <Button onClick={requestWalletConnection} className="cta-button !py-2 !px-4">
                Connect Wallet
              </Button>
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Address</dt>
                <dd className="flex items-center gap-1.5 break-all font-mono text-sm">
                  {userAddress}
                  <CopyButton value={userAddress} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Balance</dt>
                <dd className="text-sm font-medium">
                  {accountLoading ? <Skeleton className="h-5 w-24" /> : `${formatBalance(account?.balance)} STRATO`}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Nonce</dt>
                <dd className="text-sm font-medium">
                  {accountLoading ? <Skeleton className="h-5 w-12" /> : account?.nonce ?? 0}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {userAddress ? <MyWalletsCard ownerAddress={userAddress} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Registered users on this STRATO network.</CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).map((u) => (
                  <TableRow key={u.address || u.username}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        {u.address ? shortenHex(u.address) : "—"}
                        {u.address ? <CopyButton value={u.address} /> : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {(users ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

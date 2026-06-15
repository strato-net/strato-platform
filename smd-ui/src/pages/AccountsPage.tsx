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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SendTokensDialog } from "@/components/accounts/SendTokensDialog";
import { useUser } from "@/context/UserContext";
import { useAccountDetail, useCertificates } from "@/services/accounts";
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
  const { data: certificates, isLoading: certsLoading } = useCertificates();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="View balances and send tokens across STRATO accounts."
        actions={userAddress ? <SendTokensDialog /> : null}
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
                <dd className="break-all font-mono text-sm">{userAddress}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Balance</dt>
                <dd className="text-sm font-medium">
                  {accountLoading ? <Skeleton className="h-5 w-24" /> : `${formatBalance(account?.balance)} STRT`}
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

      <Card>
        <CardHeader>
          <CardTitle>Network accounts</CardTitle>
          <CardDescription>Registered identities on this STRATO network.</CardDescription>
        </CardHeader>
        <CardContent>
          {certsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Common name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(certificates ?? []).map((c) => (
                  <TableRow key={c.userAddress}>
                    <TableCell className="font-medium">{c.commonName}</TableCell>
                    <TableCell className="text-muted-foreground">{c.organization || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{shortenHex(c.userAddress)}</TableCell>
                    <TableCell className="text-right">
                      {c.isValid === false ? (
                        <Badge variant="destructive">Invalid</Badge>
                      ) : (
                        <Badge variant="secondary">Valid</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(certificates ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No accounts found.
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

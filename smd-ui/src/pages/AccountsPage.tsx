import { formatEther } from "viem";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SendTokensDialog } from "@/components/accounts/SendTokensDialog";
import { MyWalletsCard } from "@/components/accounts/MyWalletsCard";
import { MultisigWalletsCard } from "@/components/accounts/MultisigWalletsCard";
import { CopyButton } from "@/components/CopyButton";
import { useUser } from "@/context/UserContext";
import { useAccountDetail } from "@/services/accounts";
import { requestWalletConnection } from "@/lib/auth";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="View balances and send tokens across STRATO accounts."
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Connected account</CardTitle>
              <CardDescription>The wallet currently connected to the dashboard.</CardDescription>
            </div>
            {userAddress ? <SendTokensDialog /> : null}
          </div>
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

      {userAddress ? (
        <>
          <MultisigWalletsCard ownerAddress={userAddress} />
          <MyWalletsCard ownerAddress={userAddress} />
        </>
      ) : null}
    </div>
  );
}

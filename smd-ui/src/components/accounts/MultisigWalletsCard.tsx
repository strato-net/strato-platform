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
import { DedicatedMultisigDialog } from "@/components/accounts/DedicatedMultisigDialog";
import {
  SetupInvitationDialog,
  SignerInvitationDialog,
} from "@/components/accounts/MultisigInvitationDialogs";
import {
  type MultisigWalletSummary,
  useDedicatedIssues,
  useDedicatedWalletState,
  useMyMultisigWallets,
  useMyPendingMultisigSetups,
} from "@/services/dedicatedMultisig";
import { shortenHex } from "@/lib/utils";
import { strip0x } from "@/services/userWallets";

function MultisigWalletRow({
  wallet,
  ownerAddress,
}: {
  wallet: MultisigWalletSummary;
  ownerAddress?: string | null;
}) {
  const { data: state } = useDedicatedWalletState(wallet.address);
  const { data: issues = [] } = useDedicatedIssues(wallet.address, state?.epoch);
  const now = Date.now() / 1000;
  const open = issues.filter((issue) => issue.epoch === state?.epoch && issue.expiresAt >= now);
  const needsApproval = open.filter((issue) =>
    issue.executableAt === 0 &&
    !issue.approvedSigners.some((signer) => strip0x(signer) === strip0x(wallet.signerAddress))
  ).length;
  const ready = open.filter((issue) => issue.executableAt > 0 && issue.executableAt <= now).length;

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div>{wallet.label || "Unnamed multisig wallet"}</div>
        {needsApproval || ready ? (
          <div className="text-xs text-amber-600">
            {[
              needsApproval ? `${needsApproval} need${needsApproval === 1 ? "s" : ""} your approval` : "",
              ready ? `${ready} ready to execute` : "",
            ].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="font-mono text-xs">
        <span className="inline-flex items-center gap-1.5">
          <AddrLink address={wallet.address} />
          <CopyButton value={wallet.address} />
        </span>
      </TableCell>
      <TableCell>{wallet.requiredApprovals} of {wallet.signerCount}</TableCell>
      <TableCell>
        {wallet.signerUsername ||
          (strip0x(wallet.signerAddress) === strip0x(ownerAddress ?? "")
            ? "Connected account"
            : shortenHex(wallet.signerAddress))}
      </TableCell>
      <TableCell className="text-right">
        <DedicatedMultisigDialog wallet={wallet} />
      </TableCell>
    </TableRow>
  );
}

export function MultisigWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const { data: summaries = [], isLoading: walletsLoading } = useMyMultisigWallets(ownerAddress);
  const { data: setups = [], isLoading: setupsLoading } = useMyPendingMultisigSetups(ownerAddress);
  const nominations = summaries.filter((wallet) => wallet.pendingSigner);
  const wallets = summaries.filter((wallet) => wallet.signerAddress);
  const hasPending = nominations.length > 0 || setups.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>My Multisig wallets</CardTitle>
            <CardDescription>Multisig wallets where you or one of your User wallets is a signer.</CardDescription>
          </div>
          <DedicatedMultisigDialog />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasPending ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="font-medium">Pending invitations</div>
            {nominations.map((wallet) => (
              <div key={`nomination:${wallet.address}`} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <div>Invitation to join multisig wallet {wallet.label || "Unnamed multisig wallet"}</div>
                  <div className="font-mono text-xs text-muted-foreground">{wallet.address}</div>
                </div>
                <SignerInvitationDialog wallet={wallet} />
              </div>
            ))}
            {setups.map((setup) => (
              <div key={`setup:${setup.setupHash}`} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <div>Invitation to create multisig wallet {setup.label || "Unnamed multisig wallet"}</div>
                  <div className="text-xs text-muted-foreground">
                    Approvals needed: {setup.requiredApprovals} of {setup.signerCount} ·{" "}
                    {setup.confirmedCount} of {setup.signerCount} signers confirmed
                  </div>
                </div>
                <SetupInvitationDialog setup={setup} />
              </div>
            ))}
          </div>
        ) : null}

        {walletsLoading || setupsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Approvals</TableHead>
                <TableHead>Signing as</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.map((wallet) => (
                <MultisigWalletRow key={wallet.address} wallet={wallet} ownerAddress={ownerAddress} />
              ))}
              {!wallets.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    You are not a signer of any multisig wallet yet.
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

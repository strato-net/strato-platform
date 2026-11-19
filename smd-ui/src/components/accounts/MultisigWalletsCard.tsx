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
import { CopyableAddress, CopyButton } from "@/components/CopyButton";
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
import { getMultisigConfigError, runtime } from "@/lib/env";
import { strip0x } from "@/services/userWallets";

function MultisigWalletRow({ wallet }: { wallet: MultisigWalletSummary }) {
  const { data: state } = useDedicatedWalletState(wallet.address);
  const { data: issues = [] } = useDedicatedIssues(wallet.address, state?.epoch);
  const now = Date.now() / 1000;
  const open = issues.filter((issue) => issue.epoch === state?.epoch && issue.expiresAt >= now);
  const needsApproval = open.filter((issue) =>
    issue.executableAt === 0 &&
    !issue.approvedSigners.some((signer) => strip0x(signer) === strip0x(wallet.signerAddress))
  ).length;
  const ready = open.filter((issue) => issue.executableAt > 0 && issue.executableAt <= now).length;

  const created = wallet.createdAt ? new Date(wallet.createdAt.replace(" UTC", "Z").replace(" ", "T")) : null;
  const upgradeAvailable = !!state && !state.verified && state.provenanceVerified;

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{wallet.label || "Unnamed multisig wallet"}</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs">
            <AddrLink address={wallet.address} />
            <CopyButton value={wallet.address} />
          </span>
        </div>
        <div className="flex flex-wrap gap-x-2 text-xs">
          {needsApproval ? (
            <span className="text-amber-600">{needsApproval} to approve</span>
          ) : null}
          {ready ? <span className="text-amber-600">{ready} ready to execute</span> : null}
          {upgradeAvailable ? <span className="text-amber-600">version retired</span> : null}
          {wallet.signerUsername ? (
            <span className="text-muted-foreground">signing via {wallet.signerUsername}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>{wallet.requiredApprovals} of {wallet.signerCount}</TableCell>
      <TableCell>{state?.version ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">
        {created && !Number.isNaN(created.getTime()) ? created.toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"}
      </TableCell>
      <TableCell className="text-right">
        <DedicatedMultisigDialog wallet={wallet} />
      </TableCell>
    </TableRow>
  );
}

export function MultisigWalletsCard({ ownerAddress }: { ownerAddress?: string | null }) {
  const configError = getMultisigConfigError();
  const factory = runtime.multisigFactoryAddress();
  const { data: summaries = [], isLoading: walletsLoading, isError: walletsError } =
    useMyMultisigWallets(ownerAddress);
  const { data: setups = [], isLoading: setupsLoading, isError: setupsError } =
    useMyPendingMultisigSetups(ownerAddress);
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
        {configError ? (
          <div className="text-sm text-destructive">{configError}</div>
        ) : walletsError || setupsError ? (
          <div className="text-sm text-destructive">Could not load multisig wallets.</div>
        ) : null}
        {hasPending ? (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="font-medium">Pending invitations</div>
            {nominations.map((wallet) => (
              <div key={`nomination:${wallet.address}`} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <div>Invitation to join multisig wallet {wallet.label || "Unnamed multisig wallet"}</div>
                  <CopyableAddress value={wallet.address} className="text-xs text-muted-foreground" />
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
                <TableHead>Multisig wallet</TableHead>
                <TableHead>Approvals needed</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.map((wallet) => (
                <MultisigWalletRow key={wallet.address} wallet={wallet} />
              ))}
              {!wallets.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {factory
                      ? "You are not a signer of any multisig wallet on this network yet."
                      : "Multisig wallets are unavailable until the network configuration loads."}
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

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type MultisigWalletSummary,
  type PendingMultisigSetupSummary,
  useDedicatedFactoryState,
  useDedicatedMultisigActions,
  useDedicatedSetup,
  useDedicatedWalletState,
} from "@/services/dedicatedMultisig";
import { strip0x } from "@/services/userWallets";

export function SignerInvitationDialog({ wallet }: { wallet: MultisigWalletSummary }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = useDedicatedMultisigActions(wallet.address);
  const { data: state, isLoading } = useDedicatedWalletState(open ? wallet.address : undefined);
  const name = wallet.label || "Unnamed multisig wallet";

  const accept = async () => {
    setBusy(true);
    try {
      await actions.acceptNomination(wallet.nomineeUsername);
      toast.success("Invitation accepted");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Review</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitation to join multisig wallet {name}</DialogTitle>
          <DialogDescription>Review the multisig wallet and accept the signer invitation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div>Multisig wallet address</div>
          <div className="font-mono break-all">{wallet.address}</div>
          <div>Invited signer</div>
          <div className="font-mono break-all">{wallet.nomineeAddress}</div>
          <div>Current signers</div>
          {state?.signers.map((signer) => (
            <div key={signer} className="font-mono break-all text-xs">{signer}</div>
          ))}
          <div>Approvals needed: {state ? `${state.requiredApprovals} of ${state.signers.length}` : "Checking…"}</div>
          <div>
            Waiting period: {state ? `${state.transactionTimelock / 3600} ${
              state.transactionTimelock === 3600 ? "hour" : "hours"
            }` : "Checking…"}
          </div>
          <div>Sign as</div>
          <div>{wallet.nomineeUsername || "Connected account"}</div>
          {!isLoading && state && !state.verified ? (
            <div className="text-destructive">This multisig wallet could not be verified.</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button disabled={busy || isLoading || !state?.verified} onClick={() => void accept()}>
            {busy ? "Accepting…" : "Accept invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SetupInvitationDialog({ setup: summary }: { setup: PendingMultisigSetupSummary }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: setup, isLoading: setupLoading, isError: setupError } =
    useDedicatedSetup(open ? summary.setupHash : undefined);
  const { data: factoryState, isLoading: factoryLoading, isError: factoryError } =
    useDedicatedFactoryState();
  const actions = useDedicatedMultisigActions();
  const name = summary.label || "Unnamed multisig wallet";
  const ready = !!setup && factoryState?.verified === true;

  const confirm = async () => {
    setBusy(true);
    try {
      await actions.confirmSetup(summary.setupHash, summary.signerUsername || undefined);
      toast.success("Invitation confirmed");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not confirm invitation");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await actions.cancelSetup(
        summary.setupHash,
        summary.signerUsername || summary.creatorUsername || undefined
      );
      toast.success("Invitation cancelled");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Review</Button></DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Invitation to create multisig wallet {name}</DialogTitle>
          <DialogDescription>Review the multisig wallet before confirming.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div>Invitation code</div>
          <div className="font-mono break-all">{summary.setupHash}</div>
          <div>Created by</div>
          <div className="font-mono break-all">{setup?.creator ?? summary.creator}</div>
          {setupLoading ? <div className="text-muted-foreground">Checking invitation…</div> : null}
          {!setup && (setupError || !setupLoading) ? (
            <div className="text-destructive">Could not load invitation.</div>
          ) : null}
          {setup ? (
            <>
              <div>Approvals needed: {setup.requiredApprovals} of {setup.signers.length}</div>
              <div>
                Waiting period: {setup.transactionTimelock / 3600}{" "}
                {setup.transactionTimelock === 3600 ? "hour" : "hours"}
              </div>
              <div>Multisig wallet version: {setup.initialVersion}</div>
              <div className="space-y-1">
                {setup.signers.map((signer) => (
                  <div key={signer} className="font-mono break-all text-xs">
                    {setup.confirmedSigners.some((confirmed) =>
                      strip0x(confirmed) === strip0x(signer)
                    ) ? "✓" : "○"} {signer}
                    {strip0x(signer) === strip0x(summary.signerAddress)
                      ? ` (${summary.signerUsername ? `${summary.signerUsername}, you` : "you"})`
                      : ""}
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {!factoryLoading && factoryState && !factoryState.verified ? (
            <div className="text-destructive">Multisig wallets are not set up on this network.</div>
          ) : null}
          {factoryError && !factoryState ? (
            <div className="text-destructive">Could not verify multisig wallet support for this network.</div>
          ) : null}
          <div>Sign as</div>
          <div>{summary.signerUsername || (summary.signerAddress ? "Connected account" : "Not a signer")}</div>
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
            The multisig wallet address will be available after every signer confirms.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void cancel()}>
            Cancel invitation
          </Button>
          {summary.canConfirm ? (
            <Button disabled={busy || !ready} onClick={() => void confirm()}>
              {busy ? "Confirming…" : "Confirm invitation"}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              {summary.signerConfirmed ? "You confirmed · " : ""}
              Waiting for signers · {summary.confirmedCount} of {summary.signerCount} confirmed
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

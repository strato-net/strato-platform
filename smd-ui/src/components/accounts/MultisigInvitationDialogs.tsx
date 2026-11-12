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
  useDedicatedMultisigActions,
  useDedicatedSetup,
} from "@/services/dedicatedMultisig";
import { strip0x } from "@/services/userWallets";

export function SignerInvitationDialog({ wallet }: { wallet: MultisigWalletSummary }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = useDedicatedMultisigActions(wallet.address);
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
          <div>Sign as</div>
          <div>{wallet.nomineeUsername || "Connected account"}</div>
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={() => void accept()}>
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
  const { data: setup } = useDedicatedSetup(open ? summary.setupHash : undefined);
  const actions = useDedicatedMultisigActions();
  const name = summary.label || "Unnamed multisig wallet";

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
          {setup ? (
            <>
              <div>Waiting period: {setup.transactionTimelock / 3600} hours</div>
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
            <Button disabled={busy} onClick={() => void confirm()}>
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

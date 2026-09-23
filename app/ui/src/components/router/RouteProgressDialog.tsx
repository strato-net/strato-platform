import { Loader2 } from "lucide-react";
import type { RouteExecutionProgress } from "@/interface/swap";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function RouteProgressDialog({ progress, onClose, operation = "Trade" }: {
  progress: RouteExecutionProgress | null;
  operation?: "Trade" | "Withdrawal";
  onClose: () => void;
}) {
  if (!progress) return null;
  const pending = progress.status === "pending";
  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent aria-busy={pending} className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pending ? `${operation} in progress` : progress.status === "success" ? operation === "Withdrawal" ? "Withdrawal requested" : "Trade complete" : progress.status === "unconfirmed" ? `${operation} awaiting confirmation` : `${operation} not completed`}</DialogTitle>
          <DialogDescription>{progress.message}</DialogDescription>
        </DialogHeader>
        <div role="status" aria-live="polite" className="space-y-3">
          {pending && <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={`Processing ${operation.toLowerCase()}`} />}
          {progress.transactions.map(tx => (
            <div key={tx.index} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">Step {tx.index + 1} of {tx.total}: {tx.functionName === "approve" || tx.index === 0 && tx.total > 1 ? "Token approval" : operation === "Withdrawal" ? "Withdrawal request" : "Trade"}</p>
              <p className="text-muted-foreground">{tx.status === "signing" ? "Confirm in your wallet" : tx.status === "submitting" ? "Submitting transaction…" : tx.status === "submitted" || tx.status === "confirming" ? "Waiting for confirmation…" : tx.status === "completed" ? "Confirmed" : "Not completed"}</p>
              {tx.submittedHash && <p className="mt-1 break-all font-mono text-xs">Transaction: {tx.submittedHash}</p>}
            </div>
          ))}
          {progress.hash && !progress.transactions.some(tx => tx.submittedHash === progress.hash) && <p className="break-all text-xs">Transaction: {progress.hash}</p>}
        </div>
        <DialogFooter>
          <Button onClick={onClose} disabled={pending}>{pending ? "Processing…" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

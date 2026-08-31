import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface ConfirmRow {
  label: string;
  value: string;
}

interface V3ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  rows: ConfirmRow[];
  warning?: string;
  confirmLabel: string;
  /** red confirm button for irreversible actions (e.g. removing a position) */
  destructive?: boolean;
  onConfirm: () => void;
  loading: boolean;
}

/**
 * Confirmation step for V3 liquidity actions (mint / remove / collect), so a stray
 * click can't move funds. Stays open with a spinner while the transaction runs.
 */
const V3ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  rows,
  warning,
  confirmLabel,
  destructive = false,
  onConfirm,
  loading,
}: V3ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
    <DialogContent className="max-w-[95vw] sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="text-lg md:text-xl">{title}</DialogTitle>
        {description && (
          <DialogDescription className="text-xs md:text-sm">{description}</DialogDescription>
        )}
      </DialogHeader>
      <div className="py-2 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between items-start gap-2 text-sm">
            <span className="text-muted-foreground flex-shrink-0">{row.label}</span>
            <span className="font-medium text-right break-words tabular-nums">{row.value}</span>
          </div>
        ))}
        {warning && <p className="text-warning text-xs md:text-sm">⚠️ {warning}</p>}
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="w-full sm:w-auto">
          Cancel
        </Button>
        <Button
          disabled={loading}
          onClick={onConfirm}
          className={`w-full sm:w-auto ${
            destructive
              ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              : "bg-primary hover:bg-primary/90 text-primary-foreground"
          }`}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin text-current mr-2" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default V3ConfirmDialog;

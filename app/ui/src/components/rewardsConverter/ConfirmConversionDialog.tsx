import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import NetworkFee from "@/components/NetworkFee";
import { REWARDS_CONVERT_CALLS } from "@/lib/constants";

interface ConfirmConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rewards tokens to burn, with symbol. */
  converted: string;
  /** STRATO to receive, with symbol. */
  received: string;
  confirmDisabled: boolean;
  onConfirm: () => void;
}

const ConfirmConversionDialog = ({
  open,
  onOpenChange,
  converted,
  received,
  confirmDisabled,
  onConfirm,
}: ConfirmConversionDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Confirm Conversion</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-2">
            <p>
              This will burn{" "}
              <span className="font-semibold text-foreground">{converted}</span>
              <br />
              and transfer{" "}
              <span className="font-semibold text-foreground">{received}</span>{" "}
              to you.
            </p>
            <p className="font-medium text-destructive">
              Converted tokens are burned. This cannot be undone.
            </p>
            <p className="text-xs">
              Transaction fee: <NetworkFee calls={REWARDS_CONVERT_CALLS} />
            </p>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          className="bg-green-600 hover:bg-green-700"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          Confirm & Convert
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmConversionDialog;

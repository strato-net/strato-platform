import { Button } from "@/components/ui/button";
import { Token } from "@/interface";
import { TRANSFER_FEE } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TransferConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromAsset: Token | undefined;
  fromAmount: string;
  recipient: string;
  swapLoading: boolean;
  onConfirm: () => void;
}

const TransferConfirmationModal = ({
  open,
  onOpenChange,
  fromAsset,
  fromAmount,
  recipient,
  swapLoading,
  onConfirm,
}: TransferConfirmationModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Transfer</DialogTitle>
          <DialogDescription>
            Please review your transfer details before confirming.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Token</p>
            <p className="font-medium">
              {fromAsset?.token?._symbol || fromAsset?.token?._name}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Amount</p>
            <p className="font-medium">{fromAmount}</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Recipient</p>
            <p className="font-medium text-xs break-all">{recipient}</p>
          </div>
          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Transaction Fee</span>
              <span className="font-medium">
                {TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} voucher)
              </span>
            </div>
            <div className="flex justify-between text-sm font-medium border-t pt-2">
              <span>Total</span>
              <span>
                {fromAmount} {fromAsset?.token?._symbol || fromAsset?.token?._name} + {TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} voucher) fee
              </span>
            </div>
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            onClick={onConfirm}
            disabled={swapLoading}
          >
            {swapLoading ? "Processing..." : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferConfirmationModal;
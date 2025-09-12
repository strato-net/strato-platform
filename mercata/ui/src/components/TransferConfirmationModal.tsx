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
  selectedToken: Token | undefined;
  amount: string;
  recipient: string;
  transferLoading: boolean;
  onConfirm: () => void;
}

const TransferConfirmationModal = ({
  open,
  onOpenChange,
  selectedToken,
  amount,
  recipient,
  transferLoading,
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
            <p className="text-sm text-gray-600">Token</p>
            <p className="font-medium">
              {selectedToken?.token?._symbol || selectedToken?.token?._name}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Amount</p>
            <p className="font-medium">{amount}</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Recipient</p>
            <p className="font-medium text-xs break-all">{recipient}</p>
          </div>
          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">{TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} vouchers)</span>
            </div>
            <div className="flex justify-between text-sm font-medium border-t pt-2">
              <span>Total</span>
              <span>
                {amount} {selectedToken?.token?._symbol || selectedToken?.token?._name} + {TRANSFER_FEE} USDST ({parseFloat(TRANSFER_FEE) * 100} vouchers) fee
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
            disabled={transferLoading}
          >
            {transferLoading ? "Processing..." : "Confirm Transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferConfirmationModal;
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { formatBalance } from '@/utils/numberUtils';
import { useBridgeAdminContext } from '@/context/BridgeAdminContext';

interface AbortWithdrawalModalProps {
  open: boolean;
  onClose: () => void;
  withdrawal: any;
  onSuccess: () => void;
}

const AbortWithdrawalModal = ({ open, onClose, withdrawal, onSuccess }: AbortWithdrawalModalProps) => {
  const { abortWithdrawal } = useBridgeAdminContext();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAbort = async () => {
    try {
      setLoading(true);
      await abortWithdrawal(withdrawal.withdrawalId);
      toast({ title: 'Success', description: 'Withdrawal aborted successfully' });
      onSuccess();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Failed to abort withdrawal', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const info = withdrawal?.WithdrawalInfo || {};

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abort Withdrawal</DialogTitle>
          <DialogDescription>Withdrawal ID: {withdrawal?.withdrawalId}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2 text-sm">
            <div><strong>Amount:</strong> {formatBalance(info.stratoTokenAmount || '0', undefined, 18)}</div>
            <div><strong>Recipient:</strong> {info.externalRecipient}</div>
            {info.custodyTxHash && (
              <div><strong>Safe TX:</strong> {info.custodyTxHash.slice(0, 20)}...</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleAbort}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Abort Withdrawal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AbortWithdrawalModal;


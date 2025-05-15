import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { CreditCard, ArrowLeftRight } from 'lucide-react';

interface DepositOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOption: (option: 'credit-card' | 'bridge') => void;
}

const DepositOptionsModal = ({ isOpen, onClose, onSelectOption }: DepositOptionsModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Deposit Method</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <Button
            variant="outline"
            className="flex flex-col items-center justify-center p-6 h-32"
            onClick={() => onSelectOption('credit-card')}
          >
            <CreditCard className="h-8 w-8 mb-2" />
            <span>Credit Card</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center justify-center p-6 h-32"
            onClick={() => onSelectOption('bridge')}
          >
            <ArrowLeftRight className="h-8 w-8 mb-2" />
            <span>Bridge</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DepositOptionsModal; 
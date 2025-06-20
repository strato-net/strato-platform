import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CreditCard, ArrowLeftRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DepositOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOption: (option: 'credit-card' | 'bridge') => void;
}

const DepositOptionsModal = ({ isOpen, onClose, onSelectOption }: DepositOptionsModalProps) => {
  const navigate = useNavigate();

  const handleBridgeClick = () => {
    onClose();
    navigate('/dashboard/bridge');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Deposit Method</DialogTitle>
        </DialogHeader>
        
        <div className="grid grid-cols-1 gap-4 py-4">
          <Button
            variant="outline"
            className="h-auto p-6 flex flex-col items-center gap-3 hover:bg-gray-50"
            onClick={() => onSelectOption('credit-card')}
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
              <CreditCard className="h-6 w-6 text-blue-600" />
            </div>
            <div className="text-center">
              <h3 className="font-medium">Buy USDST</h3>
              <p className="text-sm text-gray-500 mt-1">
                Purchase USDST directly using fiat currency
              </p>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-auto p-6 flex flex-col items-center gap-3 hover:bg-gray-50"
            onClick={handleBridgeClick}
          >
            <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center">
              <ArrowLeftRight className="h-6 w-6 text-purple-600" />
            </div>
            <div className="text-center">
              <h3 className="font-medium">Bridge Assets</h3>
              <p className="text-sm text-gray-500 mt-1">
                Bridge assets between Ethereum and STRATO
              </p>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DepositOptionsModal; 
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatUnits } from "ethers";

interface WithdrawModalProps {
  withdrawLoading: boolean;
  asset: any;
  isOpen: boolean;
  onClose: () => void;
  onWithdraw: (amount: number) => void;
}

const addCommasToInput = (value: string) => {
  if (!value) return '';
  const parts = value.split('.');
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  if (parts.length === 2) {
    return integerPart + '.' + parts[1];
  }
  return integerPart;
};

const WithdrawCollateralModal = ({
  withdrawLoading,
  asset,
  isOpen,
  onClose,
  onWithdraw,
}: WithdrawModalProps) => {
  const [withdrawAmount, setWithdrawAmount] = useState(0);
  const [displayAmount, setDisplayAmount] = useState("");

  const handleWithdraw = () => {
    onWithdraw(withdrawAmount);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, ''); // Remove existing commas
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      const numValue = parseFloat(value) || 0;
      setWithdrawAmount(numValue);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent aria-describedby={null} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "red" }}
            >
              {asset?._symbol?.slice(0, 2)}
            </div>
            {`Withdraw ${asset?._name} as Collateral`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available balance</span>
              <span className="font-medium">
                {formatUnits(asset?.collateralizedAmount || 0,18)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Ltv</span>
              <span className="font-medium">
                {asset?.ltv ? asset?.ltv/100 : 0}%
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Withdraw Amount</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Min: 0.01</span>
              <span>Max: {formatUnits(asset?.collateralizedAmount || 0,18)}</span>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${withdrawAmount > parseFloat(formatUnits(asset?.collateralizedAmount || 0,18)) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">{asset?._symbol || ""}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={withdrawAmount === 0 || withdrawLoading || withdrawAmount > parseFloat(formatUnits(asset?.collateralizedAmount || 0,18))}
            onClick={handleWithdraw}
            className="px-6"
          >
            {withdrawLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            Withdraw
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WithdrawCollateralModal;

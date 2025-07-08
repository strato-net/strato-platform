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

interface SupplyModalProps {
  supplyLoading: boolean;
  asset: any;
  isOpen: boolean;
  onClose: () => void;
  onSupply: (amount: number) => void;
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

const SupplyCollateralModal = ({
  supplyLoading,
  asset,
  isOpen,
  onClose,
  onSupply,
}: SupplyModalProps) => {
  const [supplyAmount, setSupplyAmount] = useState(0);
  const [displayAmount, setDisplayAmount] = useState("");

  const handleBorrow = () => {
    onSupply(supplyAmount);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/,/g, ''); // Remove existing commas
    if (/^\d*\.?\d*$/.test(value)) {
      setDisplayAmount(addCommasToInput(value));
      const numValue = parseFloat(value) || 0;
      setSupplyAmount(numValue);
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
            {`Supply ${asset?._name} as Collateral`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available balance</span>
              <span className="font-medium">
                {formatUnits(asset?.userBalance || 0,18)}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Supply Amount ({asset?._name})</label>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Max: {formatUnits(asset?.userBalance || 0,18)}</span>
            </div>
            <div className="relative">
              <Input
                placeholder="0.00"
                className={`pr-8 ${supplyAmount > parseFloat(formatUnits(asset?.userBalance || 0,18)) ? 'text-red-600' : ''}`}
                value={displayAmount}
                onChange={handleAmountChange}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">{asset?._symbol}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
          <Button
            disabled={supplyAmount === 0 || supplyLoading || supplyAmount > parseFloat(formatUnits(asset?.userBalance || 0,18))}
            onClick={handleBorrow}
            className="px-6"
          >
            {supplyLoading && (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-purple-50"></div>
            )}{" "}
            Supply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupplyCollateralModal;

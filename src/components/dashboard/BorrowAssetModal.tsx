
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

interface Asset {
  id: string;
  name: string;
  symbol: string;
  price: string;
  priceUSDT?: string;
  deposit: string;
  depositValue: number;
  image: string;
  description: string;
  color: string;
  logoText: string;
  borrowPercentage: number;
  available: boolean;
}

interface BorrowAssetModalProps {
  asset: Asset;
  isOpen: boolean;
  onClose: () => void;
  onBorrow: (amount: number) => void;
}

const BorrowAssetModal = ({ asset, isOpen, onClose, onBorrow }: BorrowAssetModalProps) => {
  const maxBorrowAmount = asset.depositValue * asset.borrowPercentage / 100;
  const [borrowAmount, setBorrowAmount] = useState(maxBorrowAmount / 2);
  const [riskLevel, setRiskLevel] = useState(0);
  
  // Calculate risk level based on borrowed amount (0-100)
  useEffect(() => {
    const risk = (borrowAmount / maxBorrowAmount) * 100;
    setRiskLevel(risk);
  }, [borrowAmount, maxBorrowAmount]);
  
  const getRiskColor = () => {
    if (riskLevel < 30) return 'bg-green-500';
    if (riskLevel < 70) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getRiskText = () => {
    if (riskLevel < 30) return 'Low';
    if (riskLevel < 70) return 'Moderate';
    return 'High';
  };

  const handleSliderChange = (value: number[]) => {
    setBorrowAmount(value[0]);
  };

  const handleBorrow = () => {
    onBorrow(borrowAmount);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div 
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: asset.color }}
            >
              {asset.logoText}
            </div>
            Borrow against {asset.name}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Available to borrow</span>
              <span className="font-medium">${maxBorrowAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Your deposit</span>
              <span className="font-medium">{asset.deposit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Loan-to-Value ratio</span>
              <span className="font-medium">{asset.borrowPercentage}%</span>
            </div>
          </div>
          
          <div className="space-y-3">
            <label className="text-sm font-medium">Borrow Amount</label>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-gray-500">$0</span>
              <span className="text-sm text-gray-500">${maxBorrowAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <Slider 
              defaultValue={[maxBorrowAmount / 2]} 
              max={maxBorrowAmount} 
              step={10} 
              onValueChange={handleSliderChange}
            />
            <div className="flex justify-between">
              <span>Selected amount:</span>
              <span className="font-semibold">
                ${borrowAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>Risk Level:</span>
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                  riskLevel < 30 ? 'bg-green-50 text-green-700' : 
                  riskLevel < 70 ? 'bg-yellow-50 text-yellow-700' : 
                  'bg-red-50 text-red-700'
                }`}>
                  {getRiskText()}
                </span>
              </div>
            </div>
            
            <div className="relative">
              <Progress value={riskLevel} className="h-2">
                <div className={`absolute inset-0 ${getRiskColor()} h-full rounded-full`} style={{ width: `${riskLevel}%` }}></div>
              </Progress>
              
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>Safe</span>
                <span>Risk Increases →</span>
                <span>Liquidation</span>
              </div>
            </div>
          </div>
          
          <div className="px-4 py-3 bg-gray-50 rounded-md text-sm">
            <p className="text-gray-600">
              Borrowing against your assets allows you to access liquidity without selling your holdings.
              Be mindful of the risk level, as high borrowing increases liquidation risk during market volatility.
            </p>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">Cancel</Button>
          <Button onClick={handleBorrow} className="px-6">Borrow Now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BorrowAssetModal;

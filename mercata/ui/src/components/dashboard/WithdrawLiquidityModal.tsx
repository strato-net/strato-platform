import { useState, useEffect } from "react";
import { parseUnits } from "ethers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { LiquidityPool } from "@/interface";

interface WithdrawLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPool: LiquidityPool | null;
  onWithdraw: (percent: string) => Promise<void>;
  usdstBalance: string;
  balanceLoading: boolean;
  withdrawLoading: boolean;
}

const WITHDRAW_FEE = "0.5";

const WithdrawLiquidityModal = ({
  isOpen,
  onOpenChange,
  selectedPool,
  onWithdraw,
  usdstBalance,
  balanceLoading,
  withdrawLoading
}: WithdrawLiquidityModalProps) => {
  const [withdrawPercent, setWithdrawPercent] = useState('');

  // Reset percent when modal closes
  useEffect(() => {
    if (!isOpen) {
      setWithdrawPercent('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!withdrawPercent || parseFloat(withdrawPercent) <= 0 || parseFloat(withdrawPercent) > 100) {
      return;
    }
    
    try {
      await onWithdraw(withdrawPercent);
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in the parent component
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
          <DialogDescription>
            Remove liquidity from the {selectedPool?._name} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-lg border p-3">
              <span className="text-sm text-gray-500">Withdraw %</span>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="0.0"
                  className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 flex-1"
                  value={withdrawPercent}
                  onChange={(e) => {
                    const value = e.target.value;
                    // Handle the case where user types just "."
                    if (value === '.') {
                      setWithdrawPercent('0.');
                      return;
                    }
                    
                    // Allow empty input
                    if (value === '') {
                      setWithdrawPercent('');
                      return;
                    }
                    
                    // Check if it's a valid number format first
                    if (!/^\d*\.?\d{0,2}$/.test(value)) {
                      return;
                    }
                    
                    // Parse the number and validate range
                    const numValue = parseFloat(value);
                    if (isNaN(numValue)) {
                      return;
                    }
                    
                    // Allow only 0-100 range
                    if (numValue >= 0 && numValue <= 100) {
                      setWithdrawPercent(value);
                    }
                  }}
                />
                <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1 flex-shrink-0">
                  {selectedPool && (
                    <>
                      <div className="flex items-center -space-x-2">
                        {selectedPool?.tokenB?.images?.[0] ? (
                          <img
                            src={selectedPool.tokenB.images[0].value}
                            alt={selectedPool._name?.split('/')[0]}
                            className="w-6 h-6 rounded-full object-cover z-10 border-2 border-white"
                          />
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                            style={{ backgroundColor: "red" }}
                          >
                            {selectedPool._name?.split('/')[0]?.slice(0, 2)}
                          </div>
                        )}
                        {selectedPool?.tokenA?.images?.[0] ? (
                          <img
                            src={selectedPool.tokenA.images[0].value}
                            alt={selectedPool._name?.split('/')[1]}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                            style={{ backgroundColor: "red" }}
                          >
                            {selectedPool._name?.split('/')[1]?.slice(0, 2)}
                          </div>
                        )}
                      </div>
                      <span className="font-medium text-sm">{selectedPool._symbol}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Percentage buttons */}
              <div className="flex gap-2 mt-6">
                {[25, 50, 75, 100].map((percent) => (
                  <Button
                    key={percent}
                    type="button"
                    variant={withdrawPercent === percent.toString() ? "default" : "outline"}
                    size="sm"
                    onClick={() => setWithdrawPercent(withdrawPercent === percent.toString() ? '' : percent.toString())}
                    className="flex-1"
                  >
                    {percent}%
                  </Button>
                ))}
              </div>
              {withdrawPercent && parseFloat(withdrawPercent) > 100 && (
                <p className="text-red-600 text-sm mt-1">Percentage cannot exceed 100%</p>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="text-sm font-medium mb-2">Current Position</div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{selectedPool?._name?.split('/')[0]}</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenABalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(6)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-1">
              <span className="text-gray-500">{selectedPool?._name?.split('/')[1]}</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenBBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(6)}
              </span>
            </div>
            
            {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
              <>
                <div className="border-t my-2 pt-2">
                  <div className="text-sm font-medium mb-1">After Withdrawal</div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500">{selectedPool._name?.split("/")[0]}</span>
                    <span className="font-medium">
                      {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenABalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-500">{selectedPool._name?.split("/")[1]}</span>
                    <span className="font-medium">
                      {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenBBalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(6)}
                    </span>
                  </div>
                </div>
              </>
            )}
            
            <div className="border-t mt-2 pt-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Transaction fee</span>
                <span>{WITHDRAW_FEE} USDST</span>
              </div>
            </div>
          </div>
          
          {/* Fee warnings */}
          {!balanceLoading && BigInt(usdstBalance || "0") < parseUnits(WITHDRAW_FEE, 18) && (
            <p className="text-red-600 text-sm">Insufficient USDST balance for transaction fee ({WITHDRAW_FEE} USDST)</p>
          )}
          {(() => {
            // Low balance warning for withdraw
            const usdstBalanceWei = BigInt(usdstBalance || "0");
            const feeWei = parseUnits(WITHDRAW_FEE, 18);
            const lowBalanceThreshold = parseUnits("0.10", 18);
            const remainingBalance = usdstBalanceWei - feeWei;
            const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
            
            return isLowBalanceWarning && usdstBalanceWei >= feeWei ? (
              <p className="text-yellow-600 text-sm">
                Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
              </p>
            ) : null;
          })()}

          <div className="pt-2">
            <Button 
              disabled={
                withdrawLoading || 
                !withdrawPercent || 
                parseFloat(withdrawPercent) <= 0 || 
                parseFloat(withdrawPercent) > 100 || 
                BigInt(usdstBalance || "0") < parseUnits(WITHDRAW_FEE, 18)
              } 
              type="submit" 
              className="w-full bg-strato-blue hover:bg-strato-blue/90"
            >
              {withdrawLoading ? (
                <div className="flex justify-center items-center h-12">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : (
                "Confirm Withdraw"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default WithdrawLiquidityModal;
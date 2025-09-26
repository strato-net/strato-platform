import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from '@/context/SwapContext';
import { WITHDRAW_FEE } from "@/lib/constants";
import { Pool } from '@/interface';
import { safeParseUnits } from '@/utils/numberUtils';
import { handleAmountInputChange, computeMaxTransferable } from '@/utils/transferValidation';

interface WithdrawFormValues {
  percent: string;
}

interface LiquidityWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: Pool | null;
  onWithdrawSuccess: () => void;
  operationInProgressRef: React.MutableRefObject<boolean>;
  usdstBalance: string;
  voucherBalance: string;
}

const LiquidityWithdrawModal = ({ 
  isOpen, 
  onClose, 
  selectedPool, 
  onWithdrawSuccess,
  operationInProgressRef,
  usdstBalance,
  voucherBalance,
}: LiquidityWithdrawModalProps) => {
  const [withdrawPercent, setWithdrawPercent] = useState('');
  const [withdrawPercentError, setWithdrawPercentError] = useState('');
  const [feeError, setFeeError] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  
  useEffect(() => {
    computeMaxTransferable("100", false, voucherBalance, usdstBalance, safeParseUnits(WITHDRAW_FEE).toString(), setFeeError);
  }, [usdstBalance, voucherBalance]);

  const { removeLiquidity } = useSwapContext();
  const { toast } = useToast();

  const form = useForm<WithdrawFormValues>({
    defaultValues: {
      percent: ''
    },
  });

  const handleClose = () => {
    setWithdrawPercent('');
    onClose();
  };

  const handleWithdrawSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current) return;

    try {
      operationInProgressRef.current = true;
      setWithdrawLoading(true);
      
      const value = BigInt([{ balance: selectedPool.lpToken.balance }]?.[0]?.balance || "0");
      const percent = withdrawPercent ? parseFloat(withdrawPercent) : 0;
      const percentScaled = BigInt(Math.floor(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000);

      await removeLiquidity({
        poolAddress: selectedPool.address,
        lpTokenAmount: calculatedAmount.toString(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Calculate the actual token amounts withdrawn
      const tokenAAmount = Number(BigInt([{ balance: selectedPool.lpToken.balance }]?.[0]?.balance || "0") * BigInt(selectedPool.tokenA.poolBalance || "0") * BigInt(Math.floor(parseFloat(withdrawPercent) * 100)) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18;
      const tokenBAmount = Number(BigInt([{ balance: selectedPool.lpToken.balance }]?.[0]?.balance || "0") * BigInt(selectedPool.tokenB.poolBalance || "0") * BigInt(Math.floor(parseFloat(withdrawPercent) * 100)) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18;
      
      const tokenAName = selectedPool.poolName?.split('/')[0] || 'Token A';
      const tokenBName = selectedPool.poolName?.split('/')[1] || 'Token B';

      handleClose();
      toast({
        title: "Success",
        description: `Withdrew ${calculatedAmount.toString()} ${selectedPool.poolName}\n\nReceived:\n• ${tokenAAmount.toFixed(6)} ${tokenAName}\n• ${tokenBAmount.toFixed(6)} ${tokenBName}`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setWithdrawLoading(false);
      operationInProgressRef.current = false;
    }
    
    // Call onWithdrawSuccess AFTER the finally block to ensure operationInProgressRef.current is false
    if (!withdrawLoading) {
      onWithdrawSuccess();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleWithdrawSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-lg border p-3">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">Percent</span>
              </div>
              <div className="flex items-center">
                <Input
                  placeholder="0.0"
                  className="border-none text-xl font-medium p-0 pl-2 h-auto focus-visible:ring-0"
                  value={withdrawPercent}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleAmountInputChange(value, setWithdrawPercent, setWithdrawPercentError, "100", 0);
                  }}
                />
                <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                  {selectedPool && (
                    <>
                      <div className="flex items-center">
                        <div className="relative w-5 h-5 z-10">
                          {selectedPool.tokenA?.images?.[0]?.value ? (
                            <img
                              src={selectedPool.tokenA.images[0].value}
                              alt={selectedPool.tokenA._name || selectedPool.poolName?.split('/')[0]}
                              className="w-5 h-5 rounded-full border border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-medium border border-white"
                              style={{ backgroundColor: "red" }}
                            >
                              {selectedPool.poolName?.split('/')[0]?.slice(0, 1)}
                            </div>
                          )}
                        </div>
                        <div className="relative w-5 h-5 -ml-1">
                          {selectedPool.tokenB?.images?.[0]?.value ? (
                            <img
                              src={selectedPool.tokenB.images[0].value}
                              alt={selectedPool.tokenB._name || selectedPool.poolName?.split('/')[1]}
                              className="w-5 h-5 rounded-full border border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-medium border border-white"
                              style={{ backgroundColor: "red" }}
                            >
                              {selectedPool.poolName?.split('/')[1]?.slice(0, 1)}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="font-medium text-sm">{selectedPool.poolSymbol}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <span></span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-blue-500"
                  onClick={() => setWithdrawPercent('100')}
                >
                  Max
                </Button>
              </div>
              {
                withdrawPercentError && (
                  <p className="text-red-600 text-sm mt-1">{withdrawPercentError}</p>
                )
              }
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{selectedPool?.poolName?.split('/')[0]} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt([{ balance: selectedPool?.lpToken?.balance || "0" }]?.[0]?.balance || "0") * BigInt(selectedPool?.tokenA.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-1">
              <span className="text-gray-500">{selectedPool?.poolName?.split('/')[1]} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt([{ balance: selectedPool?.lpToken?.balance || "0" }]?.[0]?.balance || "0") * BigInt(selectedPool?.tokenB.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
              <span>Transaction fee</span>
              <span>{WITHDRAW_FEE} USDST ({parseFloat(WITHDRAW_FEE) * 100} voucher)</span>
            </div>
            {feeError && (
              <p className="text-yellow-600 text-sm mt-1">{feeError}</p>
            )}
            {(() => {
              const usdstBalanceWei = BigInt(usdstBalance || "0");
              const feeWei = safeParseUnits(WITHDRAW_FEE, 18);
              const lowBalanceThreshold = safeParseUnits("0.10", 18);
              const remainingBalance = usdstBalanceWei - feeWei;
              const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
              
              return isLowBalanceWarning && usdstBalanceWei >= feeWei ? (
                <p className="text-yellow-600 text-sm mt-1">
                  Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                </p>
              ) : null;
            })()}
            {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
              <>
                <div className="w-full flex justify-between">
                  <span className='text-gray-500'>
                    New {selectedPool.poolName?.split("/")[0]} position
                  </span>
                  <span>
                    {(Number(BigInt([{ balance: selectedPool.lpToken.balance }]?.[0]?.balance || "0") * BigInt(selectedPool.tokenA.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                  </span>
                </div>
                <div className="w-full flex justify-between">
                  <span className='text-gray-500'>
                    New {selectedPool.poolName?.split("/")[1]} position
                  </span>
                  <span>
                    {(Number(BigInt([{ balance: selectedPool.lpToken.balance }]?.[0]?.balance || "0") * BigInt(selectedPool.tokenB.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="pt-2">
            <Button 
              disabled={
                withdrawLoading || 
                !withdrawPercent || 
                !!withdrawPercentError ||
                !!feeError
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

export default LiquidityWithdrawModal;
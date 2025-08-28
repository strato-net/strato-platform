import { useState, useEffect } from 'react';
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
import { useUser } from '@/context/UserContext';
import { useSwapContext } from '@/context/SwapContext';
import { useLendingContext } from '@/context/LendingContext';
import { usdstAddress, WITHDRAW_FEE } from "@/lib/constants";
import { LiquidityPool } from '@/interface';
import { safeParseUnits } from '@/utils/numberUtils';

interface WithdrawFormValues {
  percent: string;
}

interface LiquidityWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onWithdrawSuccess: () => void;
  operationInProgressRef: React.MutableRefObject<boolean>;
}

const LiquidityWithdrawModal = ({ 
  isOpen, 
  onClose, 
  selectedPool, 
  onWithdrawSuccess,
  operationInProgressRef 
}: LiquidityWithdrawModalProps) => {
  const [withdrawPercent, setWithdrawPercent] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [usdstBalance, setUsdstBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);

  const { removeLiquidity, fetchTokenBalances } = useSwapContext();
  const { withdrawLiquidityAll } = useLendingContext();
  const { toast } = useToast();
  const { userAddress } = useUser();

  const form = useForm<WithdrawFormValues>({
    defaultValues: {
      percent: ''
    },
  });

  useEffect(() => {
    if (selectedPool && isOpen) {
      const fetchBalances = async () => {
        try {
          setBalanceLoading(true);
          const balances = await fetchTokenBalances(selectedPool, userAddress, usdstAddress);
          setUsdstBalance(balances.usdstBalance);
          setBalanceLoading(false);
        } catch (error) {
          setBalanceLoading(false);
          toast({
            title: "Error",
            description: "Failed to fetch token balances",
            variant: "destructive",
          });
        }
      };

      fetchBalances();
    }
  }, [selectedPool, isOpen, fetchTokenBalances, userAddress, toast]);

  const handleClose = () => {
    setWithdrawPercent('');
    onClose();
  };

  const handleWithdrawSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current) return;

    try {
      operationInProgressRef.current = true;
      setWithdrawLoading(true);
      
      const value = BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0");
      const percent = withdrawPercent ? parseFloat(withdrawPercent) : 0;
      const percentScaled = BigInt(Math.round(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000);

      await removeLiquidity({
        poolAddress: selectedPool.address,
        lpTokenAmount: calculatedAmount.toString(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Calculate the actual token amounts withdrawn
      const tokenAAmount = Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenABalance || "0") * BigInt(Math.round(parseFloat(withdrawPercent) * 100)) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18;
      const tokenBAmount = Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenBBalance || "0") * BigInt(Math.round(parseFloat(withdrawPercent) * 100)) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18;
      
      const tokenAName = selectedPool._name?.split('/')[0] || 'Token A';
      const tokenBName = selectedPool._name?.split('/')[1] || 'Token B';

      handleClose();
      onWithdrawSuccess();
      toast({
        title: "Success",
        description: `Withdrew ${calculatedAmount.toString()} ${selectedPool._name}\n\nReceived:\n• ${tokenAAmount.toFixed(6)} ${tokenAName}\n• ${tokenBAmount.toFixed(6)} ${tokenBName}`,
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
                    if (value === '.') {
                      setWithdrawPercent('0.');
                      return;
                    }
                    
                    if (value === '') {
                      setWithdrawPercent('');
                      return;
                    }
                    
                    if (!/^\d*\.?\d{0,2}$/.test(value)) {
                      return;
                    }
                    
                    const numValue = parseFloat(value);
                    if (isNaN(numValue)) {
                      return;
                    }
                    
                    if (numValue >= 0 && numValue <= 100) {
                      setWithdrawPercent(value);
                    }
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
                              alt={selectedPool.tokenA.name || selectedPool._name?.split('/')[0]}
                              className="w-5 h-5 rounded-full border border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-medium border border-white"
                              style={{ backgroundColor: "red" }}
                            >
                              {selectedPool._name?.split('/')[0]?.slice(0, 1)}
                            </div>
                          )}
                        </div>
                        <div className="relative w-5 h-5 -ml-1">
                          {selectedPool.tokenB?.images?.[0]?.value ? (
                            <img
                              src={selectedPool.tokenB.images[0].value}
                              alt={selectedPool.tokenB.name || selectedPool._name?.split('/')[1]}
                              className="w-5 h-5 rounded-full border border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-medium border border-white"
                              style={{ backgroundColor: "red" }}
                            >
                              {selectedPool._name?.split('/')[1]?.slice(0, 1)}
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="font-medium text-sm">{selectedPool._symbol}</span>
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
              {withdrawPercent && parseFloat(withdrawPercent) > 100 && (
                <p className="text-red-600 text-sm mt-1">Percentage cannot exceed 100%</p>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{selectedPool?._name?.split('/')[0]} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenABalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-1">
              <span className="text-gray-500">{selectedPool?._name?.split('/')[1]} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                  (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenBBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
              <span>Transaction fee</span>
              <span>{WITHDRAW_FEE} USDST</span>
            </div>
            {!balanceLoading && BigInt(usdstBalance || "0") < safeParseUnits(WITHDRAW_FEE, 18) && (
              <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({WITHDRAW_FEE} USDST)</p>
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
                    New {selectedPool._name?.split("/")[0]} position
                  </span>
                  <span>
                    {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenABalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                  </span>
                </div>
                <div className="w-full flex justify-between">
                  <span className='text-gray-500'>
                    New {selectedPool._name?.split("/")[1]} position
                  </span>
                  <span>
                    {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenBBalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
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
                parseFloat(withdrawPercent) <= 0 || 
                parseFloat(withdrawPercent) > 100 || 
                BigInt(usdstBalance || "0") < safeParseUnits(WITHDRAW_FEE, 18)
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
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
import { safeParseUnits, formatWeiAmount, formatUnits } from '@/utils/numberUtils';
import { handleAmountInputChange, computeMaxTransferable } from '@/utils/transferValidation';
import { RewardsWidget } from '@/components/rewards/RewardsWidget';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { isMultiTokenPool } from '@/helpers/swapCalculations';

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

  const totalLiquidityBalance = useMemo(() => {
    if (!selectedPool) return "0";
    return selectedPool.lpToken.totalBalance || selectedPool.lpToken.balance || "0";
  }, [selectedPool]);

  const availableLPBalance = useMemo(() => {
    if (!selectedPool) return "0";
    return selectedPool.lpToken.balance;
  }, [selectedPool]);

  const tokenALabel = useMemo(() => {
    if (!selectedPool) return "Token A";
    return (
      selectedPool.tokenA?._symbol ||
      selectedPool.tokenA?._name ||
      selectedPool.poolName?.split(/[/-]/)?.[0] ||
      "Token A"
    );
  }, [selectedPool]);

  const tokenBLabel = useMemo(() => {
    if (!selectedPool) return "Token B";
    return (
      selectedPool.tokenB?._symbol ||
      selectedPool.tokenB?._name ||
      selectedPool.poolName?.split(/[/-]/)?.[1] ||
      "Token B"
    );
  }, [selectedPool]);

  const { removeLiquidity: removeLiquidityContext, removeLiquidityMultiToken } = useSwapContext();
  const removeLiquidity = removeLiquidityContext as (params: {
    poolAddress: string;
    lpTokenAmount: string;
  }) => Promise<void>;

  const isMultiToken = useMemo(() => selectedPool ? isMultiTokenPool(selectedPool) : false, [selectedPool]);
  const { toast } = useToast();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

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

      const value = BigInt(availableLPBalance || "0");
      const percent = withdrawPercent ? parseFloat(withdrawPercent) : 0;
      const percentScaled = BigInt(Math.floor(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000);

      if (isMultiToken && selectedPool.coins) {
        // Multi-token proportional withdrawal: min amounts = 0 (accept any)
        const minAmounts = selectedPool.coins.map(() => "0");
        await removeLiquidityMultiToken({
          poolAddress: selectedPool.address,
          lpTokenAmount: calculatedAmount.toString(),
          minAmounts,
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        const formattedLpAmount = formatWeiAmount(calculatedAmount.toString());
        handleClose();
        toast({
          title: "Success",
          description: (
            <div className="space-y-1">
              <div>Withdrew {formattedLpAmount} {selectedPool.poolName}</div>
              {selectedPool.coins.map((coin) => {
                const coinAmount = selectedPool.lpToken._totalSupply === "0"
                  ? 0
                  : Number(calculatedAmount * BigInt(coin.poolBalance || "0") / BigInt(selectedPool.lpToken._totalSupply || "1")) / 1e18;
                return (
                  <div key={coin.address}>{coin._symbol}: ~{coinAmount.toFixed(6)}</div>
                );
              })}
            </div>
          ),
          variant: "success",
        });
      } else {
        // Standard 2-token withdrawal
        await removeLiquidity({
          poolAddress: selectedPool.address,
          lpTokenAmount: calculatedAmount.toString(),
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        const tokenAAmount = selectedPool.lpToken._totalSupply === "0"
          ? 0
          : Number(calculatedAmount * BigInt(selectedPool.tokenA.poolBalance || "0") / BigInt(selectedPool.lpToken._totalSupply || "1")) / 1e18;
        const tokenBAmount = selectedPool.lpToken._totalSupply === "0"
          ? 0
          : Number(calculatedAmount * BigInt(selectedPool.tokenB.poolBalance || "0") / BigInt(selectedPool.lpToken._totalSupply || "1")) / 1e18;

        const formattedLpAmount = formatWeiAmount(calculatedAmount.toString());

        handleClose();
        toast({
          title: "Success",
          description: (
            <div className="space-y-1">
              <div>Withdrew {formattedLpAmount} {selectedPool.poolName}</div>
              <div>New {tokenALabel} position: {tokenAAmount.toFixed(6)}</div>
              <div>New {tokenBLabel} position: {tokenBAmount.toFixed(6)}</div>
            </div>
          ),
          variant: "success",
        });
      }
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

    if (!withdrawLoading) {
      onWithdrawSuccess();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleWithdrawSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-lg border p-3">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">Percent</span>
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
                <div className="flex items-center space-x-2 bg-muted rounded-md px-2 py-1">
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

          <div className="rounded-lg bg-muted/50 p-3">
            {isMultiToken && selectedPool?.coins ? (
              <>
                {selectedPool.coins.map((coin) => (
                  <div key={coin.address}>
                    <div className="flex justify-between items-center text-sm mt-1">
                      <span className="text-muted-foreground">{coin._symbol} position</span>
                      <span className="font-medium">
                        {selectedPool.lpToken._totalSupply === "0" ? "0" :
                          (Number(BigInt(totalLiquidityBalance || "0") * BigInt(coin.poolBalance || "0") / BigInt(selectedPool.lpToken._totalSupply || "1")) / 1e18).toFixed(6)}
                      </span>
                    </div>
                    {withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
                      <div className="flex justify-between items-center text-sm mt-0.5">
                        <span className="text-muted-foreground">New {coin._symbol} position</span>
                        <span className="font-medium text-blue-600">
                          {(Number(BigInt(availableLPBalance || "0") * BigInt(coin.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(6)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{tokenALabel} position</span>
                  <span className="font-medium">
                    {selectedPool?.lpToken?._totalSupply === "0" ? "0" :
                      (Number(BigInt(totalLiquidityBalance || "0") * BigInt(selectedPool?.tokenA.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
                  </span>
                </div>
                {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-muted-foreground">New {tokenALabel} position</span>
                    <span className="font-medium text-blue-600">
                      {(Number(BigInt(availableLPBalance || "0") * BigInt(selectedPool.tokenA.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm mt-1">
                  <span className="text-muted-foreground">{tokenBLabel} position</span>
                  <span className="font-medium">
                    {selectedPool?.lpToken?._totalSupply === "0" ? "0" :
                      (Number(BigInt(totalLiquidityBalance || "0") * BigInt(selectedPool?.tokenB.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
                  </span>
                </div>
                {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-muted-foreground">New {tokenBLabel} position</span>
                    <span className="font-medium text-blue-600">
                      {(Number(BigInt(availableLPBalance || "0") * BigInt(selectedPool.tokenB.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between items-center text-sm mt-5 text-muted-foreground">
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
          </div>

          {/* Estimated Rewards Display - Always visible */}
          {(() => {
            // Find activity by LP token address (Position LP rewards)
            const activity = userRewards?.activities?.find(
              (a) => a.activity.sourceContract?.toLowerCase() === selectedPool?.lpToken?.address?.toLowerCase()
            );
            if (!activity) return null;
            
            // Pass withdrawPercent and availableLPBalance for accurate stake calculation
            // The component will calculate: stakeChange = availableLPBalance × withdrawPercent
            return (
              <RewardsWidget
                userRewards={userRewards}
                activityName={activity.activity.name}
                isWithdrawal={true}
                withdrawPercent={withdrawPercent || ""}
                availableLPBalance={availableLPBalance || "0"}
                actionLabel="Withdraw"
              />
            );
          })()}

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

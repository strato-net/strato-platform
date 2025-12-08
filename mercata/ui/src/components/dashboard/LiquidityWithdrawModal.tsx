import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from '@/context/SwapContext';
import { WITHDRAW_FEE, rewardsEnabled } from "@/lib/constants";
import { Pool } from '@/interface';
import { safeParseUnits, formatWeiAmount, formatUnits } from '@/utils/numberUtils';
import { handleAmountInputChange, computeMaxTransferable } from '@/utils/transferValidation';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

// Helper function to map pool names to activity names
const getPoolActivityName = (poolName: string | undefined): string | null => {
  if (!poolName) return null;
  const name = poolName.toLowerCase();
  if (name.includes('ethst') && name.includes('usdst')) return "ETHST-USDST Swap LP";
  if (name.includes('wbtcst') && name.includes('usdst')) return "WBTCST-USDST Swap LP";
  if (name.includes('goldst') && name.includes('usdst')) return "GOLDST-USDST Swap LP";
  if (name.includes('silvst') && name.includes('usdst')) return "SILVST-USDST Swap LP";
  return null;
};

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

  const [includeStakedLPToken, setIncludeStakedLPToken] = useState<boolean>(false);

  const totalLiquidityBalance = useMemo(() => {
    if (!selectedPool) return "0";
    return selectedPool.lpToken.totalBalance || selectedPool.lpToken.balance || "0";
  }, [selectedPool]);

  // Calculate available balance based on checkbox state
  const availableLPBalance = useMemo(() => {
    if (!selectedPool) return "0";
    return includeStakedLPToken && selectedPool.lpToken.totalBalance
      ? selectedPool.lpToken.totalBalance
      : selectedPool.lpToken.balance;
  }, [selectedPool, includeStakedLPToken]);

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

  const { removeLiquidity: removeLiquidityContext } = useSwapContext();
  const removeLiquidity = removeLiquidityContext as (params: {
    poolAddress: string;
    lpTokenAmount: string;
    includeStakedLPToken?: boolean;
  }) => Promise<void>;
  const { toast } = useToast();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  const form = useForm<WithdrawFormValues>({
    defaultValues: {
      percent: ''
    },
  });

  const handleClose = () => {
    setWithdrawPercent('');
    setIncludeStakedLPToken(false);
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

      await removeLiquidity({
        poolAddress: selectedPool.address,
        lpTokenAmount: calculatedAmount.toString(),
        includeStakedLPToken: includeStakedLPToken
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Calculate the actual token amounts withdrawn
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
    <Dialog open={isOpen} onOpenChange={handleClose}>
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
              <span className="text-gray-500">{tokenALabel} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" :
                  (Number(BigInt(totalLiquidityBalance || "0") * BigInt(selectedPool?.tokenA.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">New {tokenALabel} position</span>
                <span className="font-medium text-blue-600">
                  {(Number(BigInt(availableLPBalance || "0") * BigInt(selectedPool.tokenA.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center text-sm mt-1">
              <span className="text-gray-500">{tokenBLabel} position</span>
              <span className="font-medium">
                {selectedPool?.lpToken?._totalSupply === "0" ? "0" :
                  (Number(BigInt(totalLiquidityBalance || "0") * BigInt(selectedPool?.tokenB.poolBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
              </span>
            </div>
            {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">New {tokenBLabel} position</span>
                <span className="font-medium text-blue-600">
                  {(Number(BigInt(availableLPBalance || "0") * BigInt(selectedPool.tokenB.poolBalance || "0") * (BigInt(10000) - BigInt(Math.floor(Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center text-sm mt-5 text-gray-500">
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

          {/* Estimated Rewards Display */}
          {(() => {
            const activityName = getPoolActivityName(selectedPool?.poolName);
            if (!activityName || !withdrawPercent || parseFloat(withdrawPercent) <= 0 || !availableLPBalance) return null;
            
            // Pass withdrawPercent and availableLPBalance for accurate stake calculation
            // The component will calculate: stakeChange = availableLPBalance × withdrawPercent
            return (
              <CompactRewardsDisplay
                userRewards={userRewards}
                activityName={activityName}
                isWithdrawal={true}
                withdrawPercent={withdrawPercent}
                availableLPBalance={availableLPBalance}
              />
            );
          })()}

          {/* Include Staked LP Token Checkbox - only show if pool has rewards program AND rewards are enabled */}
          {rewardsEnabled && selectedPool?.lpToken?.stakedBalance !== undefined && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-staked-lp-token"
                checked={includeStakedLPToken}
                onCheckedChange={(checked) => setIncludeStakedLPToken(checked as boolean)}
              />
              <label
                htmlFor="include-staked-lp-token"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Include staked {selectedPool?.lpToken?._symbol || 'LP token'}
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">
                    Your {selectedPool?.lpToken?._symbol || 'LP token'} may be staked in the rewards program.
                    When this option is enabled, you can withdraw the {selectedPool?.lpToken?._symbol || 'LP token'} that was staked as well.
                    If disabled, only unstaked {selectedPool?.lpToken?._symbol || 'LP token'} will be eligible for withdrawal.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

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

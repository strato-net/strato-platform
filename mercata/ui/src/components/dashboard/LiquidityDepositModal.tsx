import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleLeft, ToggleRight, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { formatUnits } from 'ethers';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress, DEPOSIT_FEE } from "@/lib/constants";
import { LiquidityPool } from '@/interface';
import { safeParseUnits } from '@/utils/numberUtils';

const formatNumber = (value: string | number): string => {
  try {
    const weiValue = safeParseUnits(value.toString(), 18);
    return formatUnits(weiValue, 18);
  } catch (error) {
    console.error('Error formatting number:', error);
    return '0';
  }
};

interface DepositFormValues {
  amount: string;
  token: string;
}

interface LiquidityDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onDepositSuccess: () => void;
  operationInProgressRef: React.MutableRefObject<boolean>;
}

const LiquidityDepositModal = ({ 
  isOpen, 
  onClose, 
  selectedPool, 
  onDepositSuccess,
  operationInProgressRef 
}: LiquidityDepositModalProps) => {
  const [token1Amount, setToken1Amount] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [tokenABalance, setTokenABalance] = useState('');
  const [tokenBBalance, setTokenBBalance] = useState('');
  const [usdstBalance, setUsdstBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [singleTokenDeposit, setSingleTokenDeposit] = useState(false);

  const { addLiquidity, getPoolByAddress, fetchTokenBalances, fetchPools, enrichPools } = useSwapContext();
  const { toast } = useToast();
  const { userAddress } = useUser();

  const form = useForm<DepositFormValues>({
    defaultValues: {
      amount: '',
      token: 'token1'
    },
  });

  useEffect(() => {
    if (selectedPool && isOpen) {
      const fetchBalances = async () => {
        try {
          setBalanceLoading(true);
          const balances = await fetchTokenBalances(selectedPool, userAddress, usdstAddress);
          setTokenABalance(balances.tokenABalance);
          setTokenBBalance(balances.tokenBBalance);
          setUsdstBalance(balances.usdstBalance);
          setBalanceLoading(false);
        } catch (error) {
          toast({
            title: "Error",
            description: "Failed to fetch token balances",
            variant: "destructive",
          });
          setBalanceLoading(false);
        }
      };

      fetchBalances();
    }
  }, [selectedPool, isOpen, fetchTokenBalances, userAddress, toast]);

  const handleClose = () => {
    setToken1Amount('');
    setToken2Amount('');
    setSingleTokenDeposit(false);
    onClose();
  };

  const handleDepositSubmit = async (values: DepositFormValues) => {
    if (!selectedPool || operationInProgressRef.current) return;

    const decimals = 18;
    const token1AmountWei = safeParseUnits(token1Amount, decimals);
    const token2AmountWei = singleTokenDeposit ? BigInt(0) : safeParseUnits(token2Amount, decimals);
    const token1Balance = BigInt(tokenABalance || "0");
    const token2Balance = BigInt(tokenBBalance || "0");

    if (token1AmountWei > token1Balance || (!singleTokenDeposit && token2AmountWei > token2Balance)) {
      toast({
        title: "Error",
        description: "Insufficient balance",
        variant: "destructive",
      });
      return;
    }

    try {
      operationInProgressRef.current = true;
      setDepositLoading(true);
      
      const isInitialLiquidity = BigInt(selectedPool.lpToken._totalSupply) === BigInt(0);
      
      if (singleTokenDeposit) {
        // For single token deposit, only provide token A
        await addLiquidity({
          poolAddress: selectedPool.address,
          maxTokenAAmount: token1AmountWei.toString(),
          tokenBAmount: "0",
        });
      } else {
        const tokenAAmount = isInitialLiquidity 
          ? safeParseUnits(token1Amount, 18)
          : safeParseUnits((parseFloat(token1Amount) * 1.02).toFixed(18), 18);
        const tokenBAmount = safeParseUnits(token2Amount, 18);

        await addLiquidity({
          poolAddress: selectedPool.address,
          maxTokenAAmount: tokenAAmount.toString(),
          tokenBAmount: tokenBAmount.toString(),
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      handleClose();
      onDepositSuccess();
      toast({
        title: "Success",
        description: `${selectedPool._name} deposited successfully.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setDepositLoading(false);
      operationInProgressRef.current = false;
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    const balance = isFirstToken ? tokenABalance : tokenBBalance;
    const token = isFirstToken ? selectedPool?.tokenA : selectedPool?.tokenB;
    const isUSDST = token?.address.toLowerCase() === usdstAddress.toLowerCase();

    let maxBigInt = BigInt(balance || "0");

    if (isUSDST) {
      const fee = safeParseUnits(DEPOSIT_FEE, 18);
      if (maxBigInt > fee) {
        maxBigInt = maxBigInt - fee;
      } else {
        maxBigInt = BigInt(0);
      }
    }

    const maxVal = formatUnits(maxBigInt, 18);

    if (isFirstToken) {
      setToken1Amount(maxVal);
      handleInputChange(maxVal, 'token1');
    } else {
      setToken2Amount(maxVal);
      handleInputChange(maxVal, 'token2');
    }
  };

  const handleInputChange = (value: string, token: 'token1' | 'token2') => {
    try {
      if (token === 'token1') {
        setToken1Amount(value);
        if (
          !singleTokenDeposit &&
          value &&
          selectedPool?.aToBRatio &&
          BigInt(safeParseUnits(selectedPool.aToBRatio, 18)) > BigInt(0)
        ) {
          const token1Wei = safeParseUnits(value, 18);
          const ratioWei = safeParseUnits(selectedPool.aToBRatio, 18);
          const token2Wei = (token1Wei * ratioWei) / BigInt(10 ** 18);
          setToken2Amount(formatUnits(token2Wei.toString(), 18));
        }
      } else {
        setToken2Amount(value);
        if (
          value &&
          selectedPool?.bToARatio &&
          BigInt(safeParseUnits(selectedPool.bToARatio, 18)) > BigInt(0)
        ) {
          const token2Wei = safeParseUnits(value, 18);
          const ratioWei = safeParseUnits(selectedPool.bToARatio, 18);
          const token1Wei = (token2Wei * ratioWei) / BigInt(10 ** 18);
          setToken1Amount(formatUnits(token1Wei.toString(), 18));
        }
      }
    } catch (error) {
      console.error('Error handling input change:', error);
      if (value === '' || /^\d*\.?\d*$/.test(value)) {
        if (token === 'token1') {
          setToken1Amount(value);
        } else {
          setToken2Amount(value);
        }
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit Liquidity</DialogTitle>
          <DialogDescription>
            Add liquidity to the {selectedPool?._name} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <div className="rounded-lg border p-2">
              <span className="text-sm text-gray-500">Amount</span>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading}
                  placeholder="0.0"
                  className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                    safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ? "text-red-500" : ""
                  }`}
                  value={token1Amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      if (value === '.') {
                        handleInputChange('0.', 'token1');
                      } else {
                        handleInputChange(value, 'token1');
                      }
                    }
                  }}
                />
                <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1 flex-shrink-0">
                  {selectedPool && (
                    <>
                      {selectedPool.tokenA?.images?.[0]?.value ? (
                        <img
                          src={selectedPool.tokenA.images[0].value}
                          alt={selectedPool.tokenA.name || selectedPool._name?.split('/')[0]}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool._name?.split('/')[0]?.slice(0, 2)}
                        </div>
                      )}
                      <span className="font-medium text-sm">{selectedPool._name?.split('/')[0]}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center'>
                <span className="text-sm text-gray-500 flex gap-1">
                  Balance: {balanceLoading ?
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    : formatUnits(tokenABalance || "0", 18)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-blue-500"
                  onClick={() => handleMaxClick(true)}
                  disabled={balanceLoading}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenA.address === usdstAddress && token1Amount && 
               safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") - safeParseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token1Amount, 18) <= BigInt(tokenABalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {selectedPool?.tokenA.address !== usdstAddress && 
               selectedPool?.tokenB.address !== usdstAddress && 
               BigInt(usdstBalance || "0") < safeParseUnits(DEPOSIT_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {(() => {
                if (selectedPool?.tokenA.address === usdstAddress && token1Amount) {
                  const inputAmountWei = safeParseUnits(token1Amount, 18);
                  const balanceWei = BigInt(tokenABalance || "0");
                  const feeWei = safeParseUnits(DEPOSIT_FEE, 18);
                  const lowBalanceThreshold = safeParseUnits("0.10", 18);
                  const remainingBalance = balanceWei - inputAmountWei - feeWei;
                  const isLowBalanceWarning = inputAmountWei > 0n &&
                    remainingBalance >= 0n &&
                    remainingBalance <= lowBalanceThreshold &&
                    inputAmountWei <= balanceWei - feeWei;

                  return isLowBalanceWarning ? (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                    </p>
                  ) : null;
                }
                return null;
              })()}
            </div>

            {/* Single Token Toggle */}
            <div className="flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                      onClick={() => {
                        setSingleTokenDeposit(!singleTokenDeposit);
                        if (!singleTokenDeposit) {
                          setToken2Amount('');
                        } else if (token1Amount) {
                          // Re-calculate token2 amount when disabling single token mode
                          handleInputChange(token1Amount, 'token1');
                        }
                      }}>
                      {singleTokenDeposit ? (
                        <ToggleRight className="h-4 w-4 text-strato-blue" />
                      ) : (
                        <ToggleLeft className="h-4 w-4 text-gray-500" />
                      )}
                      <span className="text-xs font-medium">
                        Single Token
                      </span>
                      <HelpCircle className="h-3 w-3 text-gray-400" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">
                      <strong>Single-Sided Liquidity Provision</strong>
                    </p>
                    <p className="text-xs mt-1">
                      Deposit only one token type. The protocol will automatically swap half of your deposit to the other token at the current pool rate to maintain balance. This may result in slippage depending on pool size.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Second Token */}
            <div className={`rounded-lg border p-3 ${singleTokenDeposit ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">Amount {singleTokenDeposit && '(Not Required)'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading || singleTokenDeposit}
                  placeholder="0.0"
                  className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                    safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ? "text-red-500" : ""
                  }`}
                  value={token2Amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      if (value === '.') {
                        handleInputChange('0.', 'token2');
                      } else {
                        handleInputChange(value, 'token2');
                      }
                    }
                  }}
                />
                <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1 flex-shrink-0">
                  {selectedPool && (
                    <>
                      {selectedPool.tokenB?.images?.[0]?.value ? (
                        <img
                          src={selectedPool.tokenB.images[0].value}
                          alt={selectedPool.tokenB.name || selectedPool._name?.split('/')[1]}
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
                      <span className="font-medium text-sm">{selectedPool._name?.split('/')[1]}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center'>
                <span className="text-sm text-gray-500 flex gap-1">
                  Balance: {balanceLoading ?
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                    : formatUnits(tokenBBalance || "0", 18)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-blue-500"
                  onClick={() => handleMaxClick(false)}
                  disabled={balanceLoading}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenB.address === usdstAddress && token2Amount &&
               safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") - safeParseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token2Amount, 18) <= BigInt(tokenBBalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {selectedPool?.tokenA.address !== usdstAddress && 
               selectedPool?.tokenB.address !== usdstAddress && 
               BigInt(usdstBalance || "0") < safeParseUnits(DEPOSIT_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {(() => {
                if (selectedPool?.tokenB.address === usdstAddress && token2Amount) {
                  const inputAmountWei = safeParseUnits(token2Amount, 18);
                  const balanceWei = BigInt(tokenBBalance || "0");
                  const feeWei = safeParseUnits(DEPOSIT_FEE, 18);
                  const lowBalanceThreshold = safeParseUnits("0.10", 18);
                  const remainingBalance = balanceWei - inputAmountWei - feeWei;
                  const isLowBalanceWarning = inputAmountWei > 0n &&
                    remainingBalance >= 0n &&
                    remainingBalance <= lowBalanceThreshold &&
                    inputAmountWei <= balanceWei - feeWei;

                  return isLowBalanceWarning ? (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                    </p>
                  ) : null;
                }
                return null;
              })()}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>APY</span>
              <span className="font-medium">{selectedPool?.apy ? `${selectedPool.apy}%` : "N/A"}</span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
              <span>Current pool ratio</span>
              <span className="font-medium">
                {selectedPool && `1 ${selectedPool._name?.split('/')[0]} = ${formatNumber(selectedPool.aToBRatio)} ${selectedPool._name?.split('/')[1]}`}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
              <span>Transaction fee</span>
              <span>{DEPOSIT_FEE} USDST</span>
            </div>
            {selectedPool && BigInt(selectedPool.lpToken._totalSupply) === BigInt(0) && (
              <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                <span>Initial liquidity provider:</span>
                <span>You set the initial price ratio</span>
              </div>
            )}
            {selectedPool && BigInt(selectedPool.lpToken._totalSupply) > BigInt(0) && (
              <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                <span>Subsequent liquidity:</span>
                <span className="text-right">Token A amount is calculated based on current pool ratio</span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <Button 
              disabled={
                depositLoading || 
                !token1Amount || 
                (!singleTokenDeposit && !token2Amount) || 
                safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ||
                (!singleTokenDeposit && safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0")) ||
                BigInt(usdstBalance || "0") < safeParseUnits("0.3", 18)
              } 
              type="submit" 
              className="w-full bg-strato-blue hover:bg-strato-blue/90"
            >
              {depositLoading ? (
                <div className="flex justify-center items-center h-12">
                  <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : (
                "Confirm Deposit"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidityDepositModal;
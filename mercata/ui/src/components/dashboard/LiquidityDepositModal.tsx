import { useState, useEffect } from 'react';
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
  DialogDescription
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { formatUnits } from 'ethers';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress, DEPOSIT_FEE, rewardsEnabled } from "@/lib/constants";
import { Pool } from '@/interface';
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
  selectedPool: Pool | null;
  onDepositSuccess: () => void;
  operationInProgressRef: React.MutableRefObject<boolean>;
  usdstBalance: string;
  voucherBalance: string;
}

const LiquidityDepositModal = ({ 
  isOpen, 
  onClose, 
  selectedPool, 
  onDepositSuccess,
  operationInProgressRef,
  usdstBalance,
  voucherBalance
}: LiquidityDepositModalProps) => {
  const [token1Amount, setToken1Amount] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [tokenABalance, setTokenABalance] = useState('');
  const [tokenBBalance, setTokenBBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [depositMode, setDepositMode] = useState<'A' | 'B' | 'A&B'>('A&B');
  const [stakeLPToken, setStakeLPToken] = useState<boolean>(rewardsEnabled);

  const { addLiquidityDualToken, addLiquiditySingleToken, getPoolByAddress, fetchTokenBalances, fetchPools } = useSwapContext();
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
}, [selectedPool?.address, isOpen, fetchTokenBalances, userAddress, toast]);  

  const handleClose = () => {
    setToken1Amount('');
    setToken2Amount('');
    setDepositMode('A');
    setStakeLPToken(rewardsEnabled); // Reset to default based on rewardsEnabled
    onClose();
  };

  const handleDepositModeChange = (mode: 'A' | 'B' | 'A&B') => {
    setDepositMode(mode);
    
    // Clear amounts when switching to single token modes
    if (mode === 'A') {
      setToken2Amount('');
    } else if (mode === 'B') {
      setToken1Amount('');
    }
  };

  const toggleDepositMode = () => {
    if (depositMode === 'A') {
      handleDepositModeChange('B');
    } else if (depositMode === 'B') {
      handleDepositModeChange('A&B');
    } else {
      handleDepositModeChange('A');
    }
  };

  const handleDepositSubmit = async (values: DepositFormValues) => {
    if (!selectedPool || operationInProgressRef.current) return;

    const decimals = 18;
    const token1AmountWei = safeParseUnits(token1Amount, decimals);
    const token2AmountWei = safeParseUnits(token2Amount, decimals);
    const token1Balance = BigInt(tokenABalance || "0");
    const token2Balance = BigInt(tokenBBalance || "0");

    // Validate based on deposit mode
    if (depositMode === 'A' && (token1AmountWei > token1Balance || !token1Amount)) {
      toast({
        title: "Error",
        description: "Insufficient balance for token A",
        variant: "destructive",
      });
      return;
    }

    if (depositMode === 'B' && (token2AmountWei > token2Balance || !token2Amount)) {
      toast({
        title: "Error",
        description: "Insufficient balance for token B",
        variant: "destructive",
      });
      return;
    }

    if (depositMode === 'A&B' && (token1AmountWei > token1Balance || token2AmountWei > token2Balance)) {
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
      


      if (depositMode === 'A') {
        // Single token mode - Token A
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token1AmountWei.toString(),
          isAToB: true,
          stakeLPToken: rewardsEnabled && stakeLPToken && selectedPool.lpToken.stakedBalance !== undefined
        });
      } else if (depositMode === 'B') {
        // Single token mode - Token B
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token2AmountWei.toString(),
          isAToB: false,
          stakeLPToken: rewardsEnabled && stakeLPToken && selectedPool.lpToken.stakedBalance !== undefined
        });
      } else {
        // Dual token mode
        const isInitialLiquidity = BigInt(selectedPool.lpToken._totalSupply) === BigInt(0);
        const tokenAAmount = isInitialLiquidity
          ? safeParseUnits(token1Amount, 18)
          : safeParseUnits((parseFloat(token1Amount) * 1.02).toFixed(18), 18);
        const tokenBAmount = safeParseUnits(token2Amount, 18);

        await addLiquidityDualToken({
          poolAddress: selectedPool.address,
          maxTokenAAmount: tokenAAmount.toString(),
          tokenBAmount: tokenBAmount.toString(),
          stakeLPToken: rewardsEnabled && stakeLPToken && selectedPool.lpToken.stakedBalance !== undefined
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      handleClose();
      toast({
        title: "Success",
        description: `${selectedPool.poolName} deposited successfully.`,
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
    
    // Call onDepositSuccess AFTER the finally block to ensure operationInProgressRef.current is false
    if (!depositLoading) {
      onDepositSuccess();
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    if (depositMode === 'A&B' && selectedPool?.aToBRatio && selectedPool?.bToARatio) {
      // Dual token mode: calculate maximum possible deposit based on both balances
      const tokenABalanceWei = BigInt(tokenABalance || "0");
      const tokenBBalanceWei = BigInt(tokenBBalance || "0");
      
      // Check if either token is USDST and account for fees
      const tokenAIsUSDST = selectedPool.tokenA?.address.toLowerCase() === usdstAddress.toLowerCase();
      const tokenBIsUSDST = selectedPool.tokenB?.address.toLowerCase() === usdstAddress.toLowerCase();
      
      let availableTokenA = tokenABalanceWei;
      let availableTokenB = tokenBBalanceWei;
      
      if (tokenAIsUSDST) {
        const fee = safeParseUnits(DEPOSIT_FEE, 18);
        const voucherBalanceWei = BigInt(voucherBalance || "0");
        if (voucherBalanceWei >= fee) {
          // User has enough vouchers, no need to subtract fee
          availableTokenA = tokenABalanceWei;
        } else {
          // User needs to use some USDST for fee
          const remainingFee = fee - voucherBalanceWei;
          availableTokenA = tokenABalanceWei > remainingFee ? tokenABalanceWei - remainingFee : BigInt(0);
        }
      }
      
      if (tokenBIsUSDST) {
        const fee = safeParseUnits(DEPOSIT_FEE, 18);
        const voucherBalanceWei = BigInt(voucherBalance || "0");
        if (voucherBalanceWei >= fee) {
          // User has enough vouchers, no need to subtract fee
          availableTokenB = tokenBBalanceWei;
        } else {
          // User needs to use some USDST for fee
          const remainingFee = fee - voucherBalanceWei;
          availableTokenB = tokenBBalanceWei > remainingFee ? tokenBBalanceWei - remainingFee : BigInt(0);
        }
      }
      
      // Calculate maximum possible deposit based on current pool ratio
      const aToBRatioWei = safeParseUnits(selectedPool.aToBRatio, 18);
      const bToARatioWei = safeParseUnits(selectedPool.bToARatio, 18);
      
      // Calculate what Token A amount would be needed for full Token B balance
      const tokenAAmountForFullB = (availableTokenB * aToBRatioWei) / BigInt(10 ** 18);
      
      // Calculate what Token B amount would be needed for full Token A balance  
      const tokenBAmountForFullA = (availableTokenA * bToARatioWei) / BigInt(10 ** 18);
      
      let finalTokenAAmount: bigint;
      let finalTokenBAmount: bigint;
      
      if (tokenAAmountForFullB <= availableTokenA) {
        // Token B is the limiting factor
        finalTokenBAmount = availableTokenB;
        finalTokenAAmount = tokenAAmountForFullB;
      } else {
        // Token A is the limiting factor
        finalTokenAAmount = availableTokenA;
        finalTokenBAmount = tokenBAmountForFullA;
      }
      
      // Set both amounts
      setToken1Amount(formatUnits(finalTokenAAmount, 18));
      setToken2Amount(formatUnits(finalTokenBAmount, 18));
      
    } else {
      // Single token mode: original logic
      const balance = isFirstToken ? tokenABalance : tokenBBalance;
      const token = isFirstToken ? selectedPool?.tokenA : selectedPool?.tokenB;
      const isUSDST = token?.address.toLowerCase() === usdstAddress.toLowerCase();

      let maxBigInt = BigInt(balance || "0");

      if (isUSDST) {
        const fee = safeParseUnits(DEPOSIT_FEE, 18);
        const voucherBalanceWei = BigInt(voucherBalance || "0");
        if (voucherBalanceWei >= fee) {
          // User has enough vouchers, no need to subtract fee
          maxBigInt = BigInt(balance || "0");
        } else {
          // User needs to use some USDST for fee
          const remainingFee = fee - voucherBalanceWei;
          if (maxBigInt > remainingFee) {
            maxBigInt = maxBigInt - remainingFee;
          } else {
            maxBigInt = BigInt(0);
          }
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
    }
  };

  const handleInputChange = (value: string, token: 'token1' | 'token2') => {
    try {
      if (token === 'token1') {
        setToken1Amount(value);
        if (
          value &&
          selectedPool?.aToBRatio &&
          BigInt(safeParseUnits(selectedPool.aToBRatio, 18)) > BigInt(0) &&
          depositMode === 'A&B'
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
          BigInt(safeParseUnits(selectedPool.bToARatio, 18)) > BigInt(0) &&
          depositMode === 'A&B'
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

  const isInputDisabled = (tokenType: 'A' | 'B') => {
    if (depositMode === 'A') return tokenType === 'B';
    if (depositMode === 'B') return tokenType === 'A';
    return false; // Both enabled in A&B mode
  };

  const isConfirmButtonDisabled = () => {
    if (depositLoading) return true;
    
    // Check USDST + voucher balance for transaction fee
    const feeAmount = safeParseUnits(DEPOSIT_FEE, 18);
    const usdstBalanceBigInt = BigInt(usdstBalance || "0");
    const voucherBalanceBigInt = BigInt(voucherBalance || "0");
    
    if (feeAmount > 0n && (usdstBalanceBigInt + voucherBalanceBigInt) < feeAmount) {
      return true;
    }
    
    // Check based on deposit mode
    switch (depositMode) {
      case 'A':
        return !token1Amount || safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0");
      case 'B':
        return !token2Amount || safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0");
      case 'A&B':
        return !token1Amount || !token2Amount || 
               safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ||
               safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0");
      default:
        return true;
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit Liquidity</DialogTitle>
          <DialogDescription>
            Add liquidity to the {selectedPool?.poolName} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <div className={`rounded-lg border p-2 transition-colors ${
              depositMode === 'A' ? 'border-blue-400 ' : 
              depositMode === 'A&B' ? 'border-blue-400 ' :
              'border-border bg-muted/50'
            }`}>
              <span className="text-sm text-muted-foreground">Amount</span>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading || isInputDisabled('A')}
                  placeholder="0.0"
                  className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                    safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ? "text-red-500" : ""
                  } ${isInputDisabled('A') ? "opacity-50 cursor-not-allowed" : ""}`}
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
                <div className="flex items-center space-x-2 bg-muted rounded-md px-2 py-1 flex-shrink-0">
                  {selectedPool && (
                    <>
                      {selectedPool.tokenA?.images?.[0]?.value ? (
                        <img
                          src={selectedPool.tokenA.images[0].value}
                          alt={selectedPool.tokenA._name || selectedPool.tokenA._symbol}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool.tokenA._symbol?.slice(0, 2)}
                        </div>
                      )}
                      <span className="font-medium text-sm">{selectedPool.tokenA._symbol}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center'>
                <span className="text-sm text-muted-foreground flex gap-1">
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
                  disabled={balanceLoading || isInputDisabled('A')}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenA.address === usdstAddress && token1Amount && 
               (BigInt(tokenABalance || "0") - safeParseUnits(token1Amount, 18) + BigInt(voucherBalance || "0")) < safeParseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token1Amount, 18) <= BigInt(tokenABalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {selectedPool?.tokenA.address !== usdstAddress && 
               selectedPool?.tokenB.address !== usdstAddress && 
               (BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0")) < safeParseUnits(DEPOSIT_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST + voucher balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
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

            {/* Deposit Mode Toggle */}
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-4 py-2 text-sm font-medium rounded-md border-blue-500/30 bg-blue-500/10 text-blue-500 transition-colors"
                onClick={toggleDepositMode} 
              >
                Deposit Mode ({depositMode === 'A' ? 'A' : depositMode === 'B' ? 'B' : 'A&B'})
              </Button>
            </div>

            {/* Second Token */}
            <div className={`rounded-lg border p-3 transition-colors ${
              depositMode === 'B' ? 'border-blue-400 ' : 
              depositMode === 'A&B' ? 'border-blue-400 ' :
              'border-border '
            }`}>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-muted-foreground">Amount</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading || isInputDisabled('B')}
                  placeholder="0.0"
                  className={`flex-1 border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                    safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ? "text-red-500" : ""
                  } ${isInputDisabled('B') ? "opacity-50 cursor-not-allowed" : ""}`}
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
                <div className="flex items-center space-x-2 bg-muted rounded-md px-2 py-1 flex-shrink-0">
                  {selectedPool && (
                    <>
                      {selectedPool.tokenB?.images?.[0]?.value ? (
                        <img
                          src={selectedPool.tokenB.images[0].value}
                          alt={selectedPool.tokenB._name || selectedPool.poolName?.split('/')[1]}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool.tokenB._symbol?.slice(0, 2)}
                        </div>
                      )}
                      <span className="font-medium text-sm">{selectedPool.tokenB._symbol}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center'>
                <span className="text-sm text-muted-foreground flex gap-1">
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
                  disabled={balanceLoading || isInputDisabled('B')}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenB.address === usdstAddress && token2Amount &&
               (BigInt(tokenBBalance || "0") - safeParseUnits(token2Amount, 18) + BigInt(voucherBalance || "0")) < safeParseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token2Amount, 18) <= BigInt(tokenBBalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {selectedPool?.tokenA.address !== usdstAddress && 
               selectedPool?.tokenB.address !== usdstAddress && 
               (BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0")) < safeParseUnits(DEPOSIT_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST + voucher balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
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

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>APY</span>
              <span className="font-medium">{selectedPool?.apy ? `${selectedPool.apy}%` : "N/A"}</span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-muted-foreground">
              <span>Current pool ratio</span>
              <span className="font-medium">
                {selectedPool && `1 ${selectedPool.tokenA._symbol} = ${formatNumber(selectedPool.aToBRatio)} ${selectedPool.tokenB._symbol}`}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm mt-2 text-muted-foreground">
              <span>Transaction fee</span>
              <span>{DEPOSIT_FEE} USDST ({parseFloat(DEPOSIT_FEE) * 100} voucher)</span>
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

          {/* Stake LP Token Checkbox - only show if pool has rewards program AND rewards are enabled */}
          {rewardsEnabled && selectedPool?.lpToken?.stakedBalance !== undefined && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="stake-lp-token"
                checked={stakeLPToken}
                onCheckedChange={(checked) => setStakeLPToken(checked as boolean)}
              />
              <label
                htmlFor="stake-lp-token"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Stake my {selectedPool?.lpToken?._symbol || 'LP Token'} to earn rewards
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">
                    When providing liquidity to the pool, you'll receive {selectedPool?.lpToken?._symbol ? `a ${selectedPool.lpToken._symbol} token` : 'an LP Token'} representing your share.
                    If this option is enabled, this token will be automatically staked in the rewards program.
                    The longer the token is staked, the more rewards it accrues.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          <div className="pt-2">
            <Button 
              disabled={isConfirmButtonDisabled()} 
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
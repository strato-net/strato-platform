import { useState, useEffect } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
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

interface DepositLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPool: LiquidityPool | null;
  onDeposit: (token1Amount: string, token2Amount: string) => Promise<void>;
  tokenABalance: string;
  tokenBBalance: string;
  usdstBalance: string;
  balanceLoading: boolean;
  depositLoading: boolean;
  usdstAddress: string;
}

const DEPOSIT_FEE = "0.3";

const DepositLiquidityModal = ({
  isOpen,
  onOpenChange,
  selectedPool,
  onDeposit,
  tokenABalance,
  tokenBBalance,
  usdstBalance,
  balanceLoading,
  depositLoading,
  usdstAddress
}: DepositLiquidityModalProps) => {
  const [token1Amount, setToken1Amount] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const { toast } = useToast();

  // Reset amounts when modal closes
  useEffect(() => {
    if (!isOpen) {
      setToken1Amount('');
      setToken2Amount('');
    }
  }, [isOpen]);

  const safeParseUnits = (value: string, decimals: number) => {
    try {
      if (!value || value === '') return BigInt(0);
      const cleanValue = value.replace(/[^0-9.]/g, '');
      if (cleanValue === '' || cleanValue === '.') return BigInt(0);
      return parseUnits(cleanValue, decimals);
    } catch (error) {
      console.error("Error parsing units:", error);
      return BigInt(0);
    }
  };

  const formatNumber = (value: any, decimals = 6) => {
    if (value === null || value === undefined) return '0';
    const num = parseFloat(value.toString());
    return num.toFixed(decimals);
  };

  const handleInputChange = (value: string, tokenType: 'token1' | 'token2') => {
    if (tokenType === 'token1') {
      setToken1Amount(value);
      if (selectedPool && BigInt(selectedPool.lpToken._totalSupply) > BigInt(0) && value) {
        const value1Wei = safeParseUnits(value, 18);
        if (value1Wei > 0n && BigInt(selectedPool.tokenABalance) > 0n) {
          const proportionalToken2 = (value1Wei * BigInt(selectedPool.tokenBBalance)) / BigInt(selectedPool.tokenABalance);
          setToken2Amount(formatUnits(proportionalToken2, 18));
        } else {
          setToken2Amount('');
        }
      }
    } else {
      setToken2Amount(value);
      if (selectedPool && BigInt(selectedPool.lpToken._totalSupply) > BigInt(0) && value) {
        const value2Wei = safeParseUnits(value, 18);
        if (value2Wei > 0n && BigInt(selectedPool.tokenBBalance) > 0n) {
          const proportionalToken1 = (value2Wei * BigInt(selectedPool.tokenABalance)) / BigInt(selectedPool.tokenBBalance);
          setToken1Amount(formatUnits(proportionalToken1, 18));
        } else {
          setToken1Amount('');
        }
      }
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    const balance = isFirstToken ? tokenABalance : tokenBBalance;
    const token = isFirstToken ? selectedPool?.tokenA : selectedPool?.tokenB;
    const isUSDST = token?.address.toLowerCase() === usdstAddress.toLowerCase();
    let maxBigInt = BigInt(balance || "0");
    if (isUSDST) {
      const depositFeeWei = parseUnits(DEPOSIT_FEE, 18);
      const buffer = parseUnits("0.1", 18); // Keep 0.1 USDST as buffer
      maxBigInt = maxBigInt > (depositFeeWei + buffer) ? maxBigInt - depositFeeWei - buffer : BigInt(0);
    }
    const maxFormatted = formatUnits(maxBigInt, 18);
    handleInputChange(maxFormatted, isFirstToken ? 'token1' : 'token2');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token1Amount || !token2Amount) {
      toast({
        title: "Error",
        description: "Please enter both token amounts",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await onDeposit(token1Amount, token2Amount);
      onOpenChange(false);
    } catch (error) {
      // Error handling is done in the parent component
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit Liquidity</DialogTitle>
          <DialogDescription>
            Add liquidity to the {selectedPool?._name} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <div className="rounded-lg border p-3">
              <span className="text-sm text-gray-500">Amount</span>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading}
                  placeholder="0.0"
                  className={`border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 flex-1 ${
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
                      {selectedPool?.tokenA?.images?.[0] ? (
                        <img
                          src={selectedPool.tokenA.images[0].value}
                          alt={selectedPool._name?.split('/')[0]}
                          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium flex-shrink-0"
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
                  variant="link"
                  size="sm"
                  onClick={() => handleMaxClick(true)}
                  className="ml-auto text-primary"
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenA.address === usdstAddress && token1Amount && 
               safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") - parseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token1Amount, 18) <= BigInt(tokenABalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {selectedPool?.tokenA.address !== usdstAddress && 
               selectedPool?.tokenB.address !== usdstAddress && 
               BigInt(usdstBalance || "0") < parseUnits(DEPOSIT_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {(() => {
                if (selectedPool?.tokenA.address === usdstAddress && token1Amount) {
                  const inputAmountWei = safeParseUnits(token1Amount, 18);
                  const balanceWei = BigInt(tokenABalance || "0");
                  const feeWei = parseUnits(DEPOSIT_FEE, 18);
                  const lowBalanceThreshold = parseUnits("0.10", 18);
                  const remainingBalance = balanceWei - inputAmountWei - feeWei;
                  const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                  
                  return isLowBalanceWarning && inputAmountWei <= balanceWei - feeWei ? (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                    </p>
                  ) : null;
                }
                
                if (selectedPool?.tokenA.address !== usdstAddress && 
                    selectedPool?.tokenB.address !== usdstAddress && 
                    token1Amount) {
                  const usdstBalanceWei = BigInt(usdstBalance || "0");
                  const feeWei = parseUnits(DEPOSIT_FEE, 18);
                  const lowBalanceThreshold = parseUnits("0.10", 18);
                  const remainingBalance = usdstBalanceWei - feeWei;
                  const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                  
                  return isLowBalanceWarning && usdstBalanceWei >= feeWei ? (
                    <p className="text-yellow-600 text-sm mt-1">
                      Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                    </p>
                  ) : null;
                }
                
                return null;
              })()}
            </div>

            {/* Second Token */}
            <div className="rounded-lg border p-3">
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">Amount</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  disabled={balanceLoading}
                  placeholder="0.0"
                  className={`border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 flex-1 ${
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
                      {selectedPool?.tokenB?.images?.[0] ? (
                        <img
                          src={selectedPool.tokenB.images[0].value}
                          alt={selectedPool._name?.split('/')[1]}
                          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium flex-shrink-0"
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
                  variant="link"
                  size="sm"
                  onClick={() => handleMaxClick(false)}
                  className="ml-auto text-primary"
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
              {selectedPool?.tokenB.address === usdstAddress && token2Amount &&
               safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") - parseUnits(DEPOSIT_FEE, 18) && 
               safeParseUnits(token2Amount, 18) <= BigInt(tokenBBalance || "0") && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
              )}
              {(() => {
                if (selectedPool?.tokenB.address === usdstAddress && token2Amount) {
                  const inputAmountWei = safeParseUnits(token2Amount, 18);
                  const balanceWei = BigInt(tokenBBalance || "0");
                  const feeWei = parseUnits(DEPOSIT_FEE, 18);
                  const lowBalanceThreshold = parseUnits("0.10", 18);
                  const remainingBalance = balanceWei - inputAmountWei - feeWei;
                  const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                  
                  return isLowBalanceWarning && inputAmountWei <= balanceWei - feeWei ? (
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
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">LP tokens to receive</span>
              <span className="font-medium">-</span>
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
                !token2Amount || 
                safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ||
                safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ||
                BigInt(usdstBalance || "0") < parseUnits("0.3", 18)
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

export default DepositLiquidityModal;
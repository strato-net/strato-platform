import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [depositMode, setDepositMode] = useState<'A' | 'B' | 'A&B'>('A&B');

  const { addLiquidityDualToken, addLiquiditySingleToken, getPoolByAddress, fetchTokenBalances, fetchPools, enrichPools } = useSwapContext();
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
}, [selectedPool?.address, isOpen, fetchTokenBalances, userAddress, toast]);  

  const handleClose = () => {
    setToken1Amount('');
    setToken2Amount('');
    setDepositMode('A');
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
          isAToB: true
        });
      } else if (depositMode === 'B') {
        // Single token mode - Token B
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token2AmountWei.toString(),
          isAToB: false
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
          tokenBAmount: tokenBAmount.toString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      handleClose();
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
    
    // Call onDepositSuccess AFTER the finally block to ensure operationInProgressRef.current is false
    if (!depositLoading) {
      onDepositSuccess();
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    const balance = isFirstToken ? tokenABalance : tokenBBalance;
    const token = isFirstToken ? selectedPool?.tokenA : selectedPool?.tokenB;
    const isUSDST = token?.address.toLowerCase() === usdstAddress.toLowerCase();

    let maxBigInt = BigInt(balance || "0");

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
            Add liquidity to the {selectedPool?._name} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <div className={`rounded-lg border p-2 transition-colors ${
              depositMode === 'A' ? 'border-blue-400 ' : 
              depositMode === 'A&B' ? 'border-blue-400 ' :
              'border-gray-200 bg-gray-50'
            }`}>
              <span className="text-sm text-gray-500">Amount</span>
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
                  disabled={balanceLoading || isInputDisabled('A')}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
            </div>

            {/* Deposit Mode Toggle */}
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-4 py-2 text-sm font-medium rounded-md border-blue-200 bg-blue-50 text-blue-700 transition-colors"
                onClick={toggleDepositMode} 
              >
                Deposit Mode ({depositMode === 'A' ? 'A' : depositMode === 'B' ? 'B' : 'A&B'})
              </Button>
            </div>

            {/* Second Token */}
            <div className={`rounded-lg border p-3 transition-colors ${
              depositMode === 'B' ? 'border-blue-400 ' : 
              depositMode === 'A&B' ? 'border-blue-400 ' :
              'border-gray-200 '
            }`}>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-500">Amount</span>
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
                  disabled={balanceLoading || isInputDisabled('B')}
                >
                  Max
                </Button>
              </div>
              {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
              )}
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
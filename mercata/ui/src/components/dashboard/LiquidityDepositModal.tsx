import { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress, DEPOSIT_FEE } from "@/lib/constants";
import { LiquidityPool } from '@/interface';
import { safeParseUnits, formatWeiAmount } from '@/utils/numberUtils';
import { useAmountValidation } from '@/utils/validationUtils';
import TokenInput from '@/components/shared/TokenInput';


interface LiquidityDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onDepositSuccess: () => Promise<void>;
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
  const [token1AmountError, setToken1AmountError] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const [token2AmountError, setToken2AmountError] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [tokenABalance, setTokenABalance] = useState('');
  const [tokenBBalance, setTokenBBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [depositMode, setDepositMode] = useState<'A' | 'B' | 'A&B'>('A&B');

  const { addLiquidityDualToken, addLiquiditySingleToken, fetchTokenBalances } = useSwapContext();
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { getMaxTransferable } = useAmountValidation();

  // Computed values
  const tokenAMaxAmount = BigInt(tokenABalance || "0");
  const tokenBMaxAmount = BigInt(tokenBBalance || "0");
  
  // Calculate vouchers required for deposit fee (1 voucher = 1 cent = 0.01 USDST)
  const depositVouchersRequired = Math.round(Number(DEPOSIT_FEE) * 100);
  
  // Token configurations
  const tokenConfigs = useMemo(() => {
    if (!selectedPool) return { tokenA: null, tokenB: null };
    
    const tokenAName = selectedPool._name?.split('/')[0] || 'Token A';
    const tokenBName = selectedPool._name?.split('/')[1] || 'Token B';
    
    return {
      tokenA: {
        name: tokenAName,
        symbol: selectedPool.tokenA?.symbol || tokenAName,
        address: selectedPool.tokenA?.address,
        decimals: selectedPool.tokenA?.customDecimals || 18,
        maxAmount: tokenAMaxAmount,
        maxTransferable: getMaxTransferable(tokenAMaxAmount, selectedPool.tokenA?.address, DEPOSIT_FEE)
      },
      tokenB: {
        name: tokenBName,
        symbol: selectedPool.tokenB?.symbol || tokenBName,
        address: selectedPool.tokenB?.address,
        decimals: selectedPool.tokenB?.customDecimals || 18,
        maxAmount: tokenBMaxAmount,
        maxTransferable: getMaxTransferable(tokenBMaxAmount, selectedPool.tokenB?.address, DEPOSIT_FEE)
      }
    };
  }, [selectedPool, tokenAMaxAmount, tokenBMaxAmount, getMaxTransferable]);


  useEffect(() => {
    if (selectedPool && isOpen) {
      let alive = true;
      
      const fetchBalances = async () => {
        try {
          if (!alive) return;
          setBalanceLoading(true);
          
          const balances = await fetchTokenBalances(selectedPool, userAddress, usdstAddress);
          
          if (!alive) return;
          setTokenABalance(balances.tokenABalance);
          setTokenBBalance(balances.tokenBBalance);
          setBalanceLoading(false);
        } catch (error) {
          if (!alive) return;
          toast({
            title: "Error",
            description: "Failed to fetch token balances",
            variant: "destructive",
          });
          setBalanceLoading(false);
        }
      };

      fetchBalances();
      
      return () => { alive = false; };
    }
  }, [selectedPool?.address, isOpen, userAddress, toast]); // Remove fetchTokenBalances from deps  

  const handleClose = () => {
    setToken1Amount('');
    setToken1AmountError('');
    setToken2Amount('');
    setToken2AmountError('');
    setDepositMode('A&B');
    onClose();
  };

  const handleDepositModeChange = (mode: 'A' | 'B' | 'A&B') => {
    setDepositMode(mode);
    
    // Clear amounts and errors when switching to single token modes
    if (mode === 'A') {
      setToken2Amount('');
      setToken2AmountError('');
    } else if (mode === 'B') {
      setToken1Amount('');
      setToken1AmountError('');
    }
  };

  // Auto-select best available mode based on balances
  const availability = {
    A: (tokenConfigs.tokenA?.maxTransferable || 0n) > 0n,
    B: (tokenConfigs.tokenB?.maxTransferable || 0n) > 0n,
  };
  
  // Auto-select the best available mode when balances change
  useEffect(() => {
    if (!isOpen || balanceLoading) return;
    
    const bothAvailable = availability.A && availability.B;
    const onlyA = availability.A && !availability.B;
    const onlyB = !availability.A && availability.B;
    
    if (bothAvailable) {
      setDepositMode('A&B');
    } else if (onlyA) {
      setDepositMode('A');
    } else if (onlyB) {
      setDepositMode('B');
    }
  }, [availability.A, availability.B, isOpen, balanceLoading]);


  const handleDepositSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current) return;

    // Check for validation errors first
    if (token1AmountError || token2AmountError) {
      toast({
        title: "Error",
        description: "Please fix validation errors before proceeding",
        variant: "destructive",
      });
      return;
    }

    try {
      operationInProgressRef.current = true;
      setDepositLoading(true);

      if (depositMode === 'A') {
        // Single token mode - Token A
        const token1AmountWei = safeParseUnits(token1Amount, 18);
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token1AmountWei.toString(),
          isAToB: true
        });
      } else if (depositMode === 'B') {
        // Single token mode - Token B
        const token2AmountWei = safeParseUnits(token2Amount, 18);
        await addLiquiditySingleToken({
          poolAddress: selectedPool.address,
          singleTokenAmount: token2AmountWei.toString(),
          isAToB: false
        });
      } else {
        // Dual token mode
        const isInitialLiquidity = BigInt(selectedPool.lpToken._totalSupply) === BigInt(0);
        const aRaw = safeParseUnits(token1Amount || "0");
        const tokenAAmount = isInitialLiquidity 
          ? aRaw
          : (aRaw * 102n) / 100n; // 2% slippage using BigInt
        const tokenBAmount = safeParseUnits(token2Amount || "0");
        
        await addLiquidityDualToken({
          poolAddress: selectedPool.address,
          maxTokenAAmount: tokenAAmount.toString(),
          tokenBAmount: tokenBAmount.toString()
        });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));

      toast({
        title: "Success",
        description: `${selectedPool._name} deposited successfully.`,
        variant: "success",
      });
      
      // Success path - refresh data and close modal
      await onDepositSuccess();
      handleClose();
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

  const isInputDisabled = (tokenType: 'A' | 'B') => {
    if (depositMode === 'A') return tokenType === 'B';
    if (depositMode === 'B') return tokenType === 'A';
    return false; // Both enabled in A&B mode
  };

  const isConfirmButtonDisabled = () => {
    if (depositLoading) return true;
    if (balanceLoading) return true;
    
    // Check for validation errors
    if (token1AmountError || token2AmountError) {
      return true;
    }
    
    // Check based on deposit mode
    switch (depositMode) {
      case 'A':
        return !token1Amount;
      case 'B':
        return !token2Amount;
      case 'A&B':
        return !token1Amount || !token2Amount;
      default:
        return true;
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deposit Liquidity</DialogTitle>
          <DialogDescription>
            Add liquidity to the {selectedPool?._name} pool.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleDepositSubmit(); }} className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* First Token */}
            <TokenInput
              value={token1Amount}
              error={token1AmountError}
              tokenName={`${tokenConfigs.tokenA?.name || 'Token A'} Amount`}
              tokenSymbol={tokenConfigs.tokenA?.symbol || 'Token A'}
              tokenAddress={tokenConfigs.tokenA?.address || ''}
              maxAmount={tokenConfigs.tokenA?.maxAmount || 0n}
              transactionFee={DEPOSIT_FEE}
              decimals={tokenConfigs.tokenA?.decimals || 18}
              disabled={balanceLoading || isInputDisabled('A') || (tokenConfigs.tokenA?.maxTransferable || 0n) === 0n}
              loading={depositLoading}
              onValueChange={setToken1Amount}
              onErrorChange={setToken1AmountError}
            />

            {/* Deposit Mode Selection */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={(tokenConfigs.tokenA?.maxTransferable || 0n) === 0n}
                className={`px-4 py-2 text-sm font-medium rounded-md border-blue-200 transition-colors ${
                  (tokenConfigs.tokenA?.maxTransferable || 0n) === 0n
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : depositMode === 'A' 
                      ? 'bg-blue-50 text-blue-700 border-blue-400' 
                      : 'bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
                onClick={() => handleDepositModeChange('A')}
              >
                Token A Only
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={(tokenConfigs.tokenB?.maxTransferable || 0n) === 0n}
                className={`px-4 py-2 text-sm font-medium rounded-md border-blue-200 transition-colors ${
                  (tokenConfigs.tokenB?.maxTransferable || 0n) === 0n
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : depositMode === 'B' 
                      ? 'bg-blue-50 text-blue-700 border-blue-400' 
                      : 'bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
                onClick={() => handleDepositModeChange('B')}
              >
                Token B Only
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={(tokenConfigs.tokenA?.maxTransferable || 0n) === 0n || (tokenConfigs.tokenB?.maxTransferable || 0n) === 0n}
                className={`px-4 py-2 text-sm font-medium rounded-md border-blue-200 transition-colors ${
                  ((tokenConfigs.tokenA?.maxTransferable || 0n) === 0n || (tokenConfigs.tokenB?.maxTransferable || 0n) === 0n)
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : depositMode === 'A&B' 
                      ? 'bg-blue-50 text-blue-700 border-blue-400' 
                      : 'bg-white text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                }`}
                onClick={() => handleDepositModeChange('A&B')}
              >
                Both Tokens
              </Button>
            </div>

            {/* Second Token */}
            <TokenInput
              value={token2Amount}
              error={token2AmountError}
              tokenName={`${tokenConfigs.tokenB?.name || 'Token B'} Amount`}
              tokenSymbol={tokenConfigs.tokenB?.symbol || 'Token B'}
              tokenAddress={tokenConfigs.tokenB?.address || ''}
              maxAmount={tokenConfigs.tokenB?.maxAmount || 0n}
              transactionFee={DEPOSIT_FEE}
              decimals={tokenConfigs.tokenB?.decimals || 18}
              disabled={balanceLoading || isInputDisabled('B') || (tokenConfigs.tokenB?.maxTransferable || 0n) === 0n}
              loading={depositLoading}
              onValueChange={setToken2Amount}
              onErrorChange={setToken2AmountError}
            />
          </div>

          <div className="rounded-lg bg-gray-50 p-6">
            <h3 className="font-medium mb-4">Pool Information</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">APY</span>
                <span className="font-medium text-sm">{selectedPool?.apy ? `${selectedPool.apy}%` : "N/A"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Current pool ratio</span>
                <span className="font-medium text-sm text-right">
                  {selectedPool && `1 ${selectedPool._name?.split('/')[0]} = ${formatWeiAmount(safeParseUnits(selectedPool.aToBRatio.toString()), 18)} ${selectedPool._name?.split('/')[1]}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Transaction fee</span>
                <span className="font-medium text-sm">{DEPOSIT_FEE} USDST ({depositVouchersRequired} vouchers required)</span>
              </div>
            </div>
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
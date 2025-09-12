import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from '@/hooks/use-toast';
import { useSwapContext } from '@/context/SwapContext';
import { WITHDRAW_FEE } from "@/lib/constants";
import { LiquidityPool } from '@/interface';
import { formatBalance, fmt } from '@/utils/numberUtils';
import TokenInput from '@/components/shared/TokenInput';

interface LiquidityWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPool: LiquidityPool | null;
  onWithdrawSuccess: () => Promise<void>;
  operationInProgressRef: React.MutableRefObject<boolean>;
}

const LiquidityWithdrawModal = ({ 
  isOpen, 
  onClose, 
  selectedPool, 
  onWithdrawSuccess,
  operationInProgressRef 
}: LiquidityWithdrawModalProps) => {
  // ============================================================================
  // STATE
  // ============================================================================
  const [withdrawPercent, setWithdrawPercent] = useState('');
  const [withdrawPercentError, setWithdrawPercentError] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);

  // ============================================================================
  // HOOKS & CONTEXT
  // ============================================================================
  const { removeLiquidity } = useSwapContext();
  const { toast } = useToast();

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  
  // Pool data
  const lpBal = useMemo(() => BigInt(selectedPool?.lpToken?.balances?.[0]?.balance ?? "0"), [selectedPool]);
  const totalSupply = useMemo(() => BigInt(selectedPool?.lpToken?._totalSupply ?? "0"), [selectedPool]);
  const tokenA = useMemo(() => BigInt(selectedPool?.tokenABalance ?? "0"), [selectedPool]);
  const tokenB = useMemo(() => BigInt(selectedPool?.tokenBBalance ?? "0"), [selectedPool]);
  
  // User position
  const position = useMemo(() => {
    if (!selectedPool || totalSupply === 0n || lpBal === 0n) return { a: 0n, b: 0n };
    return {
      a: (lpBal * tokenA) / totalSupply,
      b: (lpBal * tokenB) / totalSupply,
    };
  }, [selectedPool, lpBal, tokenA, tokenB, totalSupply]);

  // Token names
  const [tokenAName, tokenBName] = useMemo(
    () => (selectedPool?._name?.split('/') ?? ["Token A", "Token B"]),
    [selectedPool]
  );

  // Withdrawal calculations
  const percentNum = parseFloat(withdrawPercent) || 0;
  const pct = BigInt(Math.floor(percentNum));
  const lpToBurn = percentNum > 0 ? (lpBal * pct) / 100n : 0n;
  const outA = percentNum > 0 ? (position.a * pct) / 100n : 0n;
  const outB = percentNum > 0 ? (position.b * pct) / 100n : 0n;

  // UI state
  const maxWithdrawPercent = lpBal > 0n ? 100 : 0;
  const canSubmit = !withdrawPercentError && percentNum > 0 && maxWithdrawPercent > 0 && !withdrawLoading;

  // ============================================================================
  // UTILITIES
  // ============================================================================
  const vouchers = Math.round(parseFloat(WITHDRAW_FEE) * 100);


  // ============================================================================
  // HANDLERS
  // ============================================================================
  const handleClose = () => {
    setWithdrawPercent('');
    setWithdrawPercentError('');
    onClose();
  };

  const handleWithdrawSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current || !percentNum || percentNum <= 0) return;
    
    operationInProgressRef.current = true;
    setWithdrawLoading(true);
    
    try {
      await removeLiquidity({ 
        poolAddress: selectedPool.address, 
        lpTokenAmount: lpToBurn.toString() 
      });

      toast({
        title: "Success",
        description: `Received ${fmt(outA, 18, 2, 6)} ${tokenAName} • ${fmt(outB, 18, 2, 6)} ${tokenBName}`,
        variant: "success",
      });
      
      // Success path - refresh data and close modal
      await onWithdrawSuccess();
      handleClose();
    } catch (e) {
      toast({ 
        title: "Error", 
        description: String(e), 
        variant: "destructive" 
      });
    } finally {
      setWithdrawLoading(false);
      operationInProgressRef.current = false;
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={(e) => { e.preventDefault(); handleWithdrawSubmit(); }} className="space-y-4">
          {/* Input Section */}
          <div className="grid grid-cols-1 gap-4">
            <TokenInput
              value={withdrawPercent}
              error={withdrawPercentError}
              tokenName="LP Token"
              tokenSymbol="%"
              tokenAddress="0x0000000000000000000000000000000000000000"
              maxAmount={100n}
              transactionFee={WITHDRAW_FEE}
              decimals={0}
              disabled={maxWithdrawPercent === 0}
              loading={withdrawLoading}
              onValueChange={setWithdrawPercent}
              onErrorChange={setWithdrawPercentError}
            />
          </div>

          {/* Position Information */}
          <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">LP Tokens</span>
              <span className="font-medium">
                {formatBalance(lpBal, selectedPool?._symbol || 'LP', 18, 2, 6)}
              </span>
            </div>
            
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{tokenAName} position</span>
              <span className="font-medium">
                {percentNum > 0 ? (
                  <span>
                    {fmt(position.a - outA, 18, 2, 6)}
                    <span className="text-green-600 ml-2">(+{fmt(outA, 18, 2, 6)})</span>
                  </span>
                ) : (
                  fmt(position.a, 18, 2, 6)
                )}
              </span>
            </div>
            
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{tokenBName} position</span>
              <span className="font-medium">
                {percentNum > 0 ? (
                  <span>
                    {fmt(position.b - outB, 18, 2, 6)}
                    <span className="text-green-600 ml-2">(+{fmt(outB, 18, 2, 6)})</span>
                  </span>
                ) : (
                  fmt(position.b, 18, 2, 6)
                )}
              </span>
            </div>
            
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Transaction Fee</span>
              <span className="font-medium">
                {WITHDRAW_FEE} USDST ({vouchers} vouchers)
              </span>
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <Button 
              disabled={!canSubmit}
              type="submit" 
              className="w-full bg-strato-blue hover:bg-strato-blue/90"
            >
              {withdrawLoading ? "Withdrawing..." : "Confirm Withdraw"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LiquidityWithdrawModal;
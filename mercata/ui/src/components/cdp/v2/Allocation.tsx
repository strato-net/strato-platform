import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits } from 'ethers';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';
import { convertStabilityFeeRateToAnnualPercentage } from '@/services/cdpUtils';
import type { PlanItem } from '@/services/cdpTypes';
import type { VaultCandidate } from '@/services/mintPlanService';
import { formatUSD, formatPercentage, calculateTotalCollateralValue, getAssetColor } from '@/utils/loanUtils';

interface AllocationProps {
  optimalAllocations: PlanItem[];
  vaultCandidates: VaultCandidate[];
  showMintAmounts?: boolean; // If true, show both deposit and mint amounts; if false, only deposit
  onDepositAmountChange?: (assetAddress: string, amount: string) => void;
  onMintAmountChange?: (assetAddress: string, amount: string) => void;
}

const Allocation: React.FC<AllocationProps> = ({
  optimalAllocations,
  vaultCandidates,
  showMintAmounts = false,
  onDepositAmountChange,
  onMintAmountChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});
  const [mintAmounts, setMintAmounts] = useState<Record<string, string>>({});

  // Sync amounts from optimal allocations
  useEffect(() => {
    const newDepositAmounts: Record<string, string> = {};
    const newMintAmounts: Record<string, string> = {};
    
    optimalAllocations.forEach(alloc => {
      const depositAmount = parseFloat(alloc.depositAmount || '0');
      const mintAmount = parseFloat(alloc.mintAmount || '0');
      
      if (depositAmount > 0) {
        newDepositAmounts[alloc.assetAddress] = formatNumberWithCommas(alloc.depositAmount);
      }
      if (mintAmount > 0) {
        newMintAmounts[alloc.assetAddress] = formatNumberWithCommas(alloc.mintAmount);
      }
    });
    
    // Initialize all vault candidates with 0 if they don't have allocations
    vaultCandidates.forEach(candidate => {
      if (!newDepositAmounts[candidate.assetAddress]) {
        newDepositAmounts[candidate.assetAddress] = '0';
      }
      if (!newMintAmounts[candidate.assetAddress]) {
        newMintAmounts[candidate.assetAddress] = '0';
      }
    });
    
    setDepositAmounts(newDepositAmounts);
    setMintAmounts(newMintAmounts);
  }, [optimalAllocations, vaultCandidates]);

  // Calculate total collateral value
  const totalCollateralValue = useMemo(() => 
    calculateTotalCollateralValue(optimalAllocations),
  [optimalAllocations]);

  // Handle deposit amount changes
  const handleDepositChange = useCallback((assetAddress: string, value: string) => {
    const parsed = parseCommaNumber(value);
    if (parsed === '' || parsed === '.' || /^\d*\.?\d*$/.test(parsed)) {
      const formatted = formatNumberWithCommas(parsed);
      setDepositAmounts(prev => ({ ...prev, [assetAddress]: formatted }));
      if (onDepositAmountChange) {
        onDepositAmountChange(assetAddress, formatted);
      }
    }
  }, [onDepositAmountChange]);

  // Handle mint amount changes
  const handleMintChange = useCallback((assetAddress: string, value: string) => {
    const parsed = parseCommaNumber(value);
    if (parsed === '' || parsed === '.' || /^\d*\.?\d*$/.test(parsed)) {
      const formatted = formatNumberWithCommas(parsed);
      setMintAmounts(prev => ({ ...prev, [assetAddress]: formatted }));
      if (onMintAmountChange) {
        onMintAmountChange(assetAddress, formatted);
      }
    }
  }, [onMintAmountChange]);


  return (
    <div className="space-y-2">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:bg-muted/80"
          >
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium cursor-pointer">Vault Collateral Needed</Label>
              <span className="text-sm text-muted-foreground">(Value: ${formatUSD(totalCollateralValue, 1)})</span>
            </div>
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 p-3 border border-border rounded-md bg-muted/50 space-y-3">
            <div className="text-sm font-semibold">
              Total Value of Collateral: ${formatUSD(totalCollateralValue, 1)}
            </div>
            <div className="space-y-2">
              <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border ${showMintAmounts ? 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr_minmax(80px,auto)]' : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_minmax(80px,auto)]'}`}>
                <div>Asset</div>
                <div>Stability Fee</div>
                <div>Deposit Amount</div>
                {showMintAmounts && <div>Mint Amount</div>}
                <div className={showMintAmounts ? "ml-4" : ""}>Value</div>
              </div>
              {vaultCandidates.map((candidate) => {
                const allocation = optimalAllocations.find(a => a.assetAddress === candidate.assetAddress);
                const depositAmountStr = depositAmounts[candidate.assetAddress] || '0';
                const mintAmountStr = mintAmounts[candidate.assetAddress] || '0';
                const depositAmount = parseFloat(parseCommaNumber(depositAmountStr));
                const priceUSD = parseFloat(formatUnits(candidate.oraclePrice, 18));
                const valueUSD = depositAmount * priceUSD;
                const assetColor = getAssetColor(candidate.symbol);
                const stabilityFeeRate = allocation 
                  ? allocation.stabilityFeeRate 
                  : convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate);

                return (
                  <div key={candidate.assetAddress} className={`grid gap-2 items-center text-sm ${showMintAmounts ? 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr_minmax(80px,auto)]' : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_minmax(80px,auto)]'}`}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                        style={{ backgroundColor: assetColor }}
                      >
                        {candidate.symbol.slice(0, 2)}
                      </div>
                      <span className="font-medium">{candidate.symbol}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {formatPercentage(stabilityFeeRate)}
                    </div>
                    <div>
                      <Input
                        value={depositAmountStr}
                        onChange={(e) => handleDepositChange(candidate.assetAddress, e.target.value)}
                        placeholder="0"
                        inputMode="decimal"
                        className="h-8 text-xs"
                      />
                    </div>
                    {showMintAmounts && (
                      <div>
                        <Input
                          value={mintAmountStr}
                          onChange={(e) => handleMintChange(candidate.assetAddress, e.target.value)}
                          placeholder="0"
                          inputMode="decimal"
                          className="h-8 text-xs"
                        />
                      </div>
                    )}
                    <div className={`font-semibold ${showMintAmounts ? "ml-4" : ""}`}>
                      ${formatUSD(valueUSD, 1)}
                    </div>
                  </div>
                );
              })}
              {vaultCandidates.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-2">
                  No vault candidates available
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default Allocation;


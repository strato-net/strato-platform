import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits } from 'ethers';
import { formatNumberWithCommas } from '@/utils/numberUtils';
import { convertStabilityFeeRateToAnnualPercentage } from '@/services/cdpUtils';
import type { PlanItem } from '@/services/cdpTypes';
import type { VaultCandidate } from '@/services/MintService';
import { formatPercentage, getAssetColor } from '@/utils/loanUtils';
import { useTokenContext } from '@/context/TokenContext';

interface AllocationProps {
  optimalAllocations: PlanItem[];
  vaultCandidates: VaultCandidate[];
  showMintAmounts?: boolean;
  onDepositAmountChange?: (assetAddress: string, amount: string) => void;
  onMintAmountChange?: (assetAddress: string, amount: string) => void;
  autoSupplyCollateral?: boolean;
}

const Allocation: React.FC<AllocationProps> = ({
  optimalAllocations,
  vaultCandidates,
  showMintAmounts = false,
  onDepositAmountChange,
  onMintAmountChange,
  autoSupplyCollateral = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [mintInputs, setMintInputs] = useState<Record<string, string>>({});
  const [displayMode, setDisplayMode] = useState<'USD' | 'WAD'>('USD');
  const { earningAssets, inactiveTokens } = useTokenContext();

  // Helper: get oracle price for an asset
  const getPrice = (assetAddress: string): number => {
    const c = vaultCandidates.find(v => v.assetAddress === assetAddress);
    return c ? parseFloat(formatUnits(c.oraclePrice, 18)) : 0;
  };

  // Format a token amount for display
  const formatDeposit = (assetAddress: string, tokenAmount: number, mode: 'USD' | 'WAD'): string => {
    if (tokenAmount === 0) return '';
    if (mode === 'USD') {
      const price = getPrice(assetAddress);
      return '$' + formatNumberWithCommas((tokenAmount * price).toFixed(2));
    }
    return formatNumberWithCommas(tokenAmount.toString());
  };

  // Format a USDST amount for display
  const formatMint = (usdstAmount: number, mode: 'USD' | 'WAD'): string => {
    if (usdstAmount === 0) return '';
    if (mode === 'USD') {
      return '$' + formatNumberWithCommas(usdstAmount.toFixed(2));
    }
    return formatNumberWithCommas(usdstAmount.toString());
  };

  // Parse display value to token amount
  const parseDepositToToken = (assetAddress: string, displayValue: string, mode: 'USD' | 'WAD'): number => {
    const cleanValue = displayValue.replace(/[$,]/g, '');
    const numVal = parseFloat(cleanValue);
    if (isNaN(numVal)) return 0;
    
    if (mode === 'USD') {
      const price = getPrice(assetAddress);
      return price > 0 ? numVal / price : 0;
    }
    return numVal;
  };

  // Parse display value to USDST amount
  const parseMintToUsdst = (displayValue: string): number => {
    const cleanValue = displayValue.replace(/[$,]/g, '');
    const numVal = parseFloat(cleanValue);
    return isNaN(numVal) ? 0 : numVal;
  };

  // Populate inputs from optimalAllocations (only when allocations change)
  useEffect(() => {
    const deposits: Record<string, string> = {};
    const mints: Record<string, string> = {};

    optimalAllocations.forEach(alloc => {
      const depositAmt = parseFloat(alloc.depositAmount || '0');
      const mintAmt = parseFloat(alloc.mintAmount || '0');

      deposits[alloc.assetAddress] = formatDeposit(alloc.assetAddress, depositAmt, displayMode);
      mints[alloc.assetAddress] = formatMint(mintAmt, displayMode);
    });

    // Initialize empty fields for all vault candidates
    vaultCandidates.forEach(c => {
      if (deposits[c.assetAddress] === undefined) deposits[c.assetAddress] = '';
      if (mints[c.assetAddress] === undefined) mints[c.assetAddress] = '';
    });

    setDepositInputs(deposits);
    setMintInputs(mints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimalAllocations, vaultCandidates]);

  // Handle displayMode toggle - convert current values, don't re-read from allocations
  const handleDisplayModeToggle = () => {
    const oldMode = displayMode;
    const newMode = oldMode === 'USD' ? 'WAD' : 'USD';
    setDisplayMode(newMode);

    // Convert current deposit values to new format
    setDepositInputs(prev => {
      const converted: Record<string, string> = {};
      Object.entries(prev).forEach(([addr, val]) => {
        const tokenAmount = parseDepositToToken(addr, val, oldMode);
        converted[addr] = formatDeposit(addr, tokenAmount, newMode);
      });
      return converted;
    });

    // Convert current mint values to new format
    setMintInputs(prev => {
      const converted: Record<string, string> = {};
      Object.entries(prev).forEach(([addr, val]) => {
        const usdstAmount = parseMintToUsdst(val);
        converted[addr] = formatMint(usdstAmount, newMode);
      });
      return converted;
    });
  };

  // Handle deposit input change
  const handleDepositChange = (assetAddress: string, value: string) => {
    setDepositInputs(prev => ({ ...prev, [assetAddress]: value }));
    
    if (!autoSupplyCollateral && onDepositAmountChange) {
      const tokenAmount = parseDepositToToken(assetAddress, value, displayMode);
      onDepositAmountChange(assetAddress, tokenAmount.toString());
    }
  };

  // Handle mint input change
  const handleMintChange = (assetAddress: string, value: string) => {
    setMintInputs(prev => ({ ...prev, [assetAddress]: value }));
    
    if (!autoSupplyCollateral && onMintAmountChange) {
      const usdstAmount = parseMintToUsdst(value);
      onMintAmountChange(assetAddress, usdstAmount.toString());
    }
  };

  return (
    <div className="space-y-2">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:bg-muted/80"
          >
            <Label className="text-sm font-medium cursor-pointer">Vault Breakdown</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDisplayModeToggle();
                }}
                className="h-6 px-2 text-xs"
              >
                {displayMode}
              </Button>
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 pl-3 pt-3 pb-3 border border-border rounded-md bg-muted/50 space-y-3">
            <div className="space-y-2">
              <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border ${showMintAmounts ? 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr]' : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr]'}`}>
                <div>Asset</div>
                <div>Stability Fee</div>
                <div>Deposit</div>
                {showMintAmounts && <div>Mint</div>}
              </div>
              {vaultCandidates.map((candidate) => {
                const allocation = optimalAllocations.find(a => a.assetAddress === candidate.assetAddress);
                const stabilityFeeRate = allocation 
                  ? allocation.stabilityFeeRate 
                  : convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate);
                
                // Find token image from earningAssets or inactiveTokens
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                return (
                  <div key={candidate.assetAddress} className={`grid gap-2 items-center text-sm ${showMintAmounts ? 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr]' : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr]'}`}>
                    <div className="flex items-center gap-2">
                      {tokenImage ? (
                        <img
                          src={tokenImage}
                          alt={candidate.symbol}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                          style={{ backgroundColor: getAssetColor(candidate.symbol) }}
                        >
                          {candidate.symbol.slice(0, 2)}
                        </div>
                      )}
                      <span className="font-medium">{candidate.symbol}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {formatPercentage(stabilityFeeRate)}
                    </div>
                    <div>
                      <Input
                        value={depositInputs[candidate.assetAddress] || ''}
                        onChange={(e) => handleDepositChange(candidate.assetAddress, e.target.value)}
                        placeholder="0"
                        className="h-8 text-xs"
                        disabled={autoSupplyCollateral}
                      />
                    </div>
                    {showMintAmounts && (
                      <div>
                        <Input
                          value={mintInputs[candidate.assetAddress] || ''}
                          onChange={(e) => handleMintChange(candidate.assetAddress, e.target.value)}
                          placeholder="0"
                          className="h-8 text-xs"
                          disabled={autoSupplyCollateral}
                        />
                      </div>
                    )}
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

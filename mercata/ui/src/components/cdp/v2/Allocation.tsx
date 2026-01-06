import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits, parseUnits } from 'ethers';
import type { PlanItem } from '@/services/cdpTypes';
import type { VaultCandidate } from '@/services/MintService';
import { formatPercentage, getAssetColor, convertStabilityFeeRateToAnnualPercentage } from '@/utils/loanUtils';
import { useTokenContext } from '@/context/TokenContext';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';

interface AllocationProps {
  optimalAllocations: PlanItem[];
  vaultCandidates: VaultCandidate[];
  showMintAmounts?: boolean;
  onDepositAmountChange?: (assetAddress: string, amount: string) => void;
  onMintAmountChange?: (assetAddress: string, amount: string) => void;
  autoSupplyCollateral?: boolean;
  targetHF?: number; // Target HF from slider (riskBuffer)
  onHFValidationChange?: (hasLowHF: boolean) => void; // Callback when HF validation changes
}

const Allocation: React.FC<AllocationProps> = ({
  optimalAllocations,
  vaultCandidates,
  showMintAmounts = false,
  onDepositAmountChange,
  onMintAmountChange,
  autoSupplyCollateral = true,
  targetHF,
  onHFValidationChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<'USD' | 'WAD'>('WAD');
  const { earningAssets, inactiveTokens } = useTokenContext();

  // Store canonical WAD values (always in token amounts)
  const [depositInputs, setDepositInputs] = useState<Record<string, string>>({});
  const [mintInputs, setMintInputs] = useState<Record<string, string>>({});

  // Get oracle price for an asset
  const getPrice = (assetAddress: string): number => {
    const c = vaultCandidates.find(v => v.assetAddress === assetAddress);
    return c ? parseFloat(formatUnits(c.oraclePrice, 18)) : 0;
  };

  // Parse input to number (handles commas)
  const toNumber = (input: string): number => {
    const cleaned = parseCommaNumber(input || '0');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  // Convert WAD token amount to USD for display
  const convertToUSD = (wadAmount: string, assetAddress: string): string => {
    if (!wadAmount || wadAmount === '0') return '';
    const tokenAmount = toNumber(wadAmount);
    const price = getPrice(assetAddress);
    const usdValue = tokenAmount * price;
    return usdValue > 0 ? formatNumberWithCommas(usdValue.toFixed(2)) : '';
  };

  // Convert USD display value to WAD token amount
  const convertFromUSD = (usdValue: string, assetAddress: string): string => {
    if (!usdValue || usdValue === '0') return '';
    const cleaned = parseCommaNumber(usdValue);
    const usd = toNumber(cleaned);
    const price = getPrice(assetAddress);
    const tokenAmount = price > 0 ? usd / price : 0;
    return tokenAmount > 0 ? String(tokenAmount) : '';
  };

  // Get display value based on mode
  const getDisplayValue = (wadAmount: string, assetAddress: string, isDeposit: boolean): string => {
    if (displayMode === 'USD' && isDeposit) {
      // Convert deposit amounts using token price
      return convertToUSD(wadAmount, assetAddress);
    }
    // Mint amounts are USDST ($1 each), format with commas but no conversion
    return formatNumberWithCommas(wadAmount);
  };

  // Sync from optimalAllocations when they change
  useEffect(() => {
    const newDeposits: Record<string, string> = {};
    const newMints: Record<string, string> = {};

    vaultCandidates.forEach(c => {
      const alloc = optimalAllocations.find(a => a.assetAddress === c.assetAddress);
      // IMPORTANT: keep the exact decimal strings from the plan.
      // parseFloat/String round-tripping here causes precision drift and results in the
      // tx execution plan (modal) differing from what the table displays.
      const depositStr = (alloc?.depositAmount ?? '').trim();
      const mintStr = (alloc?.mintAmount ?? '').trim();

      newDeposits[c.assetAddress] = depositStr === '' || depositStr === '0' ? '' : depositStr;
      newMints[c.assetAddress] = mintStr === '' || mintStr === '0' ? '' : mintStr;
    });

    setDepositInputs(newDeposits);
    setMintInputs(newMints);
  }, [optimalAllocations, vaultCandidates]);

  // Check for low HF and notify parent
  useEffect(() => {
    if (!onHFValidationChange || autoSupplyCollateral || targetHF === undefined) {
      return;
    }

    let hasLowHF = false;
    for (const candidate of vaultCandidates) {
      const mintInput = mintInputs[candidate.assetAddress] || '';
      const mintAmt = toNumber(mintInput);
      
      // Skip validation for vaults with empty or zero mint amount
      if (!mintInput || mintInput.trim() === '' || mintAmt === 0) {
        continue;
      }
      
      // depositInputs stores raw token amounts, use them directly for HF calculation
      const depositInput = depositInputs[candidate.assetAddress] || '';
      const depositAmt = toNumber(depositInput);
      
      const hf = calculateHF(candidate, depositAmt, mintAmt);
      const hfNum = parseFloat(hf);
      
      if (hfNum !== Infinity && !isNaN(hfNum) && hfNum < targetHF) {
        hasLowHF = true;
        break;
      }
    }
    
    onHFValidationChange(hasLowHF);
  }, [depositInputs, mintInputs, vaultCandidates, targetHF, autoSupplyCollateral, onHFValidationChange]);

  // Calculate HF for a vault - matches VaultsList formula: HF = CR / LT
  const calculateHF = (candidate: VaultCandidate, depositAmt: number, mintAmt: number): string => {
    try {
      const decimals = candidate.assetScale.toString().length - 1;
      const depositWei = depositAmt > 0 ? parseUnits(String(depositAmt), decimals) : 0n;
      const mintWei = mintAmt > 0 ? parseUnits(String(mintAmt), 18) : 0n;

      const totalCollateral = candidate.currentCollateral + depositWei;
      const totalDebt = candidate.currentDebt + mintWei;

      if (totalDebt <= 0n) return '∞';

      // Calculate collateral value in USD (18 decimals)
      const collateralValueUSD = (totalCollateral * candidate.oraclePrice) / candidate.assetScale;
      
      // Convert to numbers for percentage calculation
      const collateralUSD = parseFloat(formatUnits(collateralValueUSD, 18));
      const debtUSD = parseFloat(formatUnits(totalDebt, 18));

      // CR = (collateralUSD / debtUSD) * 100 (as percentage, e.g., 200 for 200%)
      const cr = (collateralUSD / debtUSD) * 100;
      
      // LT = liquidationRatio converted from WAD to percentage (e.g., 1.5e18 -> 150)
      const lt = parseFloat(formatUnits(candidate.liquidationRatio, 18)) * 100;

      // HF = CR / LT (same as VaultsList)
      const hf = cr / lt;

      if (!isFinite(hf) || isNaN(hf)) return '-';
      if (hf >= 999) return '∞';
      return hf.toFixed(2);
    } catch {
      return '-';
    }
  };

  const handleDepositChange = (assetAddress: string, value: string) => {
    // Parse commas and convert from display format to canonical WAD format
    const cleanValue = parseCommaNumber(value);
    const canonicalValue = displayMode === 'USD' ? convertFromUSD(value, assetAddress) : cleanValue;
    setDepositInputs(prev => ({ ...prev, [assetAddress]: canonicalValue }));
    
    if (!autoSupplyCollateral && onDepositAmountChange) {
      const tokenAmt = toNumber(canonicalValue);
      onDepositAmountChange(assetAddress, String(tokenAmt));
    }
  };

  const handleMintChange = (assetAddress: string, value: string) => {
    // Mint amounts are USDST, which = $1, so no conversion needed
    // Parse commas before storing
    const cleanValue = parseCommaNumber(value);
    setMintInputs(prev => ({ ...prev, [assetAddress]: cleanValue }));
    
    if (!autoSupplyCollateral && onMintAmountChange) {
      onMintAmountChange(assetAddress, cleanValue);
    }
  };

  const getGridClass = () => {
    if (showMintAmounts) {
      return !autoSupplyCollateral 
        ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_1fr_minmax(60px,auto)]' 
        : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr]';
    }
    return !autoSupplyCollateral 
      ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_minmax(60px,auto)]' 
      : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr]';
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
              {isOpen && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDisplayMode(prev => prev === 'USD' ? 'WAD' : 'USD');
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  className="h-6 px-2 text-xs"
                >
                  {displayMode}
                </Button>
              )}
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 pl-3 pt-3 pb-3 border border-border rounded-md bg-muted/50 space-y-3">
            <div className="space-y-2">
              <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border ${getGridClass()}`}>
                <div>Asset</div>
                <div>Stability Fee</div>
                <div>Deposit</div>
                {showMintAmounts && <div>Mint</div>}
                {!autoSupplyCollateral && <div className="text-right pr-3">HF</div>}
              </div>
              {vaultCandidates.map((candidate) => {
                const allocation = optimalAllocations.find(a => a.assetAddress === candidate.assetAddress);
                const stabilityFeeRate = allocation 
                  ? allocation.stabilityFeeRate 
                  : convertStabilityFeeRateToAnnualPercentage(candidate.stabilityFeeRate);
                
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                // depositInputs stores raw token amounts, so use them directly for HF calculation
                const depositAmt = toNumber(depositInputs[candidate.assetAddress] || '');
                const mintInput = mintInputs[candidate.assetAddress] || '';
                const mintAmt = toNumber(mintInput);
                const hf = calculateHF(candidate, depositAmt, mintAmt);
                const hfNum = parseFloat(hf);
                const hfColor = isNaN(hfNum) || hf === '∞' 
                  ? 'text-green-600' 
                  : hfNum >= 2.0 ? 'text-green-600' 
                  : hfNum >= 1.5 ? 'text-yellow-600' 
                  : 'text-red-600';
                
                // Check if HF is below target (only when auto-supply is off, targetHF is provided, and mint amount is not empty/zero)
                const hasLowHF = !autoSupplyCollateral && targetHF !== undefined && 
                  mintInput && mintInput.trim() !== '' && mintAmt > 0 &&
                  hfNum !== Infinity && !isNaN(hfNum) && hfNum < targetHF;

                return (
                  <div key={candidate.assetAddress} className={`grid gap-2 items-center text-sm ${getGridClass()}`}>
                    <div className="flex items-center gap-2">
                      {tokenImage ? (
                        <img src={tokenImage} alt={candidate.symbol} className="w-6 h-6 rounded-full object-cover" />
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
                    <div className="text-muted-foreground">{formatPercentage(stabilityFeeRate)}</div>
                    <div className="relative">
                      {displayMode === 'USD' && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
                      )}
                      <Input
                        value={getDisplayValue(depositInputs[candidate.assetAddress] || '', candidate.assetAddress, true)}
                        onChange={(e) => handleDepositChange(candidate.assetAddress, e.target.value)}
                        placeholder="0"
                        className={`h-8 text-xs ${displayMode === 'USD' ? 'pl-5' : ''} ${hasLowHF ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        disabled={autoSupplyCollateral}
                      />
                    </div>
                    {showMintAmounts && (
                      <div>
                        <Input
                          value={getDisplayValue(mintInputs[candidate.assetAddress] || '', candidate.assetAddress, false)}
                          onChange={(e) => handleMintChange(candidate.assetAddress, e.target.value)}
                          placeholder="0"
                          className={`h-8 text-xs ${hasLowHF ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                          disabled={autoSupplyCollateral}
                        />
                      </div>
                    )}
                    {!autoSupplyCollateral && (
                      <div className={`font-medium text-right pr-3 ${hfColor}`}>{hf}</div>
                    )}
                  </div>
                );
              })}
              {vaultCandidates.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-2">No vault candidates available</div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default Allocation;

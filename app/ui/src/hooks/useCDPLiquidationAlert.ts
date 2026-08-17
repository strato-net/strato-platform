import { useMemo } from 'react';
import { useCDP } from '@/context/CDPContext';
import {
  categorizeRiskLevel,
  LiquidationAlertState,
  RiskLevel,
} from '@/hooks/useLiquidationAlert';

/**
 * CDP liquidation alert.
 *
 * Unlike the lending pool (a single aggregate health factor per user), a user
 * can hold multiple CDP vaults — one per collateral asset — and each vault is
 * liquidated independently on its own health factor. So the alert is driven by
 * the WORST (minimum) health factor across vaults that carry debt, i.e. the
 * single vault closest to liquidation. An aggregate would hide one underwater
 * vault behind other healthy ones.
 *
 * Per-vault `healthFactor` is CR / liquidationRatio, so 1.0 == liquidation
 * point — the same normalization the lending alert uses, letting us reuse the
 * shared thresholds via `categorizeRiskLevel`.
 */
export const useCDPLiquidationAlert = (): LiquidationAlertState => {
  const { vaults } = useCDP();

  const riskiest = useMemo(() => {
    if (!vaults || vaults.length === 0) return null;

    let worst: { hf: number; symbol: string } | null = null;
    for (const vault of vaults) {
      // Vaults with no debt have an infinite health factor — skip them.
      const debt = BigInt(vault.debtAmount || '0');
      if (debt <= 1n) continue;

      const hf = vault.healthFactor;
      if (typeof hf !== 'number' || !isFinite(hf)) continue;

      if (worst === null || hf < worst.hf) {
        worst = { hf, symbol: vault.symbol };
      }
    }
    return worst;
  }, [vaults]);

  const currentHealthFactor = riskiest ? riskiest.hf : null;

  const riskLevel = useMemo(
    (): RiskLevel => categorizeRiskLevel(currentHealthFactor),
    [currentHealthFactor]
  );

  const message = useMemo(() => {
    if (currentHealthFactor === null) return '';
    const hfFormatted = currentHealthFactor.toFixed(2);
    const vaultLabel = riskiest?.symbol ? `${riskiest.symbol} vault` : 'vault';
    switch (riskLevel) {
      case 'critical':
        return `CRITICAL: Your ${vaultLabel} is liquidatable (HF: ${hfFormatted}). Add collateral immediately or repay debt.`;
      case 'high':
        return `WARNING: Your ${vaultLabel} health factor is ${hfFormatted}. You are very close to liquidation. Consider adding collateral or repaying debt.`;
      case 'medium':
        return `Your ${vaultLabel} health factor is ${hfFormatted}. Consider adding collateral or repaying debt to improve your position safety.`;
      default:
        return '';
    }
  }, [riskLevel, currentHealthFactor, riskiest]);

  const shouldShow = useMemo(() => {
    if (currentHealthFactor === null) return false;
    return riskLevel !== 'safe';
  }, [currentHealthFactor, riskLevel]);

  return {
    shouldShow,
    riskLevel,
    healthFactor: currentHealthFactor,
    message,
  };
};

import { useMemo } from 'react';
import { useLendingContext } from '@/context/LendingContext';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'safe';

export interface LiquidationAlertState {
  shouldShow: boolean;
  riskLevel: RiskLevel;
  healthFactor: number | null;
  message: string;
}

const RISK_THRESHOLDS = {
  CRITICAL: 1.0,
  HIGH: 1.1,
  MEDIUM: 1.2,
} as const;

export const useLiquidationAlert = (): LiquidationAlertState => {
  const { loans } = useLendingContext();

  const currentHealthFactor = useMemo(() => {
    if (!loans) return null;
    const totalOwed = BigInt(loans.totalAmountOwed || "0");
    if (totalOwed <= 1n) return null;
    const hf = loans.healthFactor;
    return typeof hf === 'number' && isFinite(hf) ? hf : null;
  }, [loans]);

  const riskLevel = useMemo((): RiskLevel => {
    if (currentHealthFactor === null) return 'safe';
    if (currentHealthFactor < RISK_THRESHOLDS.CRITICAL) return 'critical';
    if (currentHealthFactor < RISK_THRESHOLDS.HIGH) return 'high';
    if (currentHealthFactor < RISK_THRESHOLDS.MEDIUM) return 'medium';
    return 'safe';
  }, [currentHealthFactor]);

  const message = useMemo(() => {
    if (currentHealthFactor === null) return '';
    const hfFormatted = currentHealthFactor.toFixed(2);
    switch (riskLevel) {
      case 'critical':
        return ` CRITICAL: Your position is liquidatable (HF: ${hfFormatted}). Add collateral immediately or repay your loan.`;
      case 'high':
        return `WARNING: Your health factor is ${hfFormatted}. You are very close to liquidation. Consider adding collateral or repaying your loan.`;
      case 'medium':
        return `Your health factor is ${hfFormatted}. Consider adding collateral to improve your position safety.`;
      default:
        return '';
    }
  }, [riskLevel, currentHealthFactor]);

  const shouldShow = useMemo(() => {
    if (currentHealthFactor === null) return false;
    if (riskLevel === 'safe') return false;
    return true;
  }, [currentHealthFactor, riskLevel]);

  return {
    shouldShow,
    riskLevel,
    healthFactor: currentHealthFactor,
    message,
  };
};

export const getRiskLevelColor = (riskLevel: RiskLevel): string => {
  switch (riskLevel) {
    case 'critical':
    case 'high':
      return 'bg-red-500/10 dark:bg-red-500/20 border-red-500/30 text-red-800 dark:text-red-200';
    case 'medium':
      return 'bg-orange-500/10 dark:bg-orange-500/20 border-orange-500/30 text-orange-800 dark:text-orange-200';
    default:
      return 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/30 text-blue-800 dark:text-blue-200';
  }
};


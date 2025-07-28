import { useMemo } from 'react';
import { formatUnits } from 'ethers';

export interface RiskLevelData {
  percentage: number;
  level: 'Low' | 'Moderate' | 'High';
  color: string;
  badgeColor: string;
  progressColor: string;
}

export const RISK_THRESHOLDS = {
  LOW: 30,
  MODERATE: 70,
  HIGH: 100
} as const;

export const useRiskLevel = (
  totalBorrowed: string | bigint,
  collateralValue: string | bigint,
  maxAvailableToBorrow?: string | bigint
): RiskLevelData => {
  return useMemo(() => {
    try {
      const totalBorrowedBigInt = BigInt(totalBorrowed || 0);
      const collateralValueBigInt = BigInt(collateralValue || 0);
      // Use the same calculation method as Borrow.tsx for consistency
      // This represents the percentage of collateral value that is borrowed
      let percentage = 0;
      
      if (collateralValueBigInt > 0n) {
        percentage = Number((totalBorrowedBigInt * 10000n) / collateralValueBigInt) / 100;
      } else if (totalBorrowedBigInt > 0n) {
        // If no collateral but borrowed, risk is 100%
        percentage = 100;
      }
      
      // Cap at 100%
      percentage = Math.min(percentage, 100);
      
      // Determine risk level
      let level: 'Low' | 'Moderate' | 'High' = 'Low';
      let color = '#22c55e'; // green
      let badgeColor = 'bg-green-50 text-green-700';
      let progressColor = 'bg-green-500';
      
      if (percentage >= RISK_THRESHOLDS.LOW && percentage < RISK_THRESHOLDS.MODERATE) {
        level = 'Moderate';
        color = '#facc15'; // yellow
        badgeColor = 'bg-yellow-50 text-yellow-700';
        progressColor = 'bg-yellow-500';
      } else if (percentage >= RISK_THRESHOLDS.MODERATE) {
        level = 'High';
        color = '#ef4444'; // red
        badgeColor = 'bg-red-50 text-red-700';
        progressColor = 'bg-red-500';
      }
      
      return {
        percentage,
        level,
        color,
        badgeColor,
        progressColor
      };
    } catch (error) {
      console.error('Error calculating risk level:', error);
      return {
        percentage: 0,
        level: 'Low',
        color: '#22c55e',
        badgeColor: 'bg-green-50 text-green-700',
        progressColor: 'bg-green-500'
      };
    }
  }, [totalBorrowed, collateralValue, maxAvailableToBorrow]);
}; 
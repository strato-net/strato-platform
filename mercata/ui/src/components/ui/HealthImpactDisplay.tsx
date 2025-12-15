import { HealthImpactData } from "@/interface";
import { getHealthFactorColor } from "@/utils/lendingUtils";

interface HealthImpactDisplayProps {
  healthImpact: HealthImpactData;
  showWarning?: boolean;
  className?: string;
}

const HealthImpactDisplay = ({ 
  healthImpact, 
  showWarning = true, 
  className = "" 
}: HealthImpactDisplayProps) => {
  const gettingWorse =
    Number.isFinite(healthImpact.currentHealthFactor) &&
    Number.isFinite(healthImpact.newHealthFactor) &&
    healthImpact.newHealthFactor < healthImpact.currentHealthFactor;
  const shouldWarn = showWarning && !healthImpact.isHealthy && gettingWorse;

  const currentLabel =
    healthImpact.currentHealthFactor === Infinity
      ? "No Loan"
      : healthImpact.currentHealthFactor.toFixed(2);

  const newLabel =
    healthImpact.newHealthFactor === Infinity ? "No Loan" : healthImpact.newHealthFactor.toFixed(2);

  return (
    <div className={`space-y-3 p-4 bg-muted/50 rounded-lg ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">Health Impact</span>
        <div className="flex items-center gap-2">
          <span className={`font-medium ${getHealthFactorColor(healthImpact.currentHealthFactor)}`}>
            {currentLabel}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className={`font-medium ${getHealthFactorColor(healthImpact.newHealthFactor)}`}>
            {newLabel}
          </span>
          <span
            className={`font-medium ${
              healthImpact.healthImpact >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
            title="Change"
          >
            ({healthImpact.healthImpact >= 0 ? "+" : ""}
            {healthImpact.healthImpact.toFixed(2)})
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {shouldWarn && (
          <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded text-xs text-red-700 dark:text-red-400">
            ⚠️ Warning: This action would make your position
            unhealthy and vulnerable to liquidation.
          </div>
        )}
      </div>
    </div>
  );
};

export default HealthImpactDisplay; 
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
  return (
    <div className={`space-y-3 p-4 bg-muted/50 rounded-lg ${className}`}>
      <h4 className="text-sm font-medium text-foreground">
        Health Impact
      </h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Current Health Factor:</span>
          <span
            className={`font-medium ${getHealthFactorColor(
              healthImpact.currentHealthFactor
            )}`}
          >
            {healthImpact.currentHealthFactor === Infinity
              ? "No Loan"
              : healthImpact.currentHealthFactor.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">New Health Factor:</span>
          <span
            className={`font-medium ${getHealthFactorColor(
              healthImpact.newHealthFactor
            )}`}
          >
            {healthImpact.newHealthFactor === Infinity
              ? "No Loan"
              : healthImpact.newHealthFactor.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Change:</span>
          <span
            className={`font-medium ${
              healthImpact.healthImpact >= 0
                ? "text-success"
                : "text-destructive"
            }`}
          >
            {healthImpact.healthImpact >= 0 ? "+" : ""}
            {healthImpact.healthImpact.toFixed(2)}
          </span>
        </div>
        {shouldWarn && (
          <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive">
            ⚠️ Warning: This action would make your position
            unhealthy and vulnerable to liquidation.
          </div>
        )}
      </div>
    </div>
  );
};

export default HealthImpactDisplay; 
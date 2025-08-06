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
  return (
    <div className={`space-y-3 p-4 bg-gray-50 rounded-lg ${className}`}>
      <h4 className="text-sm font-medium text-gray-700">
        Health Impact
      </h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Current Health Factor:</span>
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
          <span className="text-gray-600">New Health Factor:</span>
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
          <span className="text-gray-600">Change:</span>
          <span
            className={`font-medium ${
              healthImpact.healthImpact >= 0
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {healthImpact.healthImpact >= 0 ? "+" : ""}
            {healthImpact.healthImpact.toFixed(2)}
          </span>
        </div>
        {showWarning && !healthImpact.isHealthy && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            ⚠️ Warning: This action would make your position
            unhealthy and vulnerable to liquidation.
          </div>
        )}
      </div>
    </div>
  );
};

export default HealthImpactDisplay; 
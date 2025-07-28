import { Progress } from "@/components/ui/progress";
import { useRiskLevel, RiskLevelData } from "@/hooks/useRiskLevel";

interface RiskLevelIndicatorProps {
  totalBorrowed: string | bigint;
  collateralValue: string | bigint;
  maxAvailableToBorrow?: string | bigint;
  showProgressBar?: boolean;
  showBadge?: boolean;
  showMarkers?: boolean;
  className?: string;
  variant?: 'compact' | 'detailed';
}

export const RiskLevelIndicator = ({
  totalBorrowed,
  collateralValue,
  maxAvailableToBorrow,
  showProgressBar = true,
  showBadge = true,
  showMarkers = false,
  className = "",
  variant = 'detailed'
}: RiskLevelIndicatorProps) => {
  const riskData = useRiskLevel(totalBorrowed, collateralValue, maxAvailableToBorrow);
  
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {showBadge && (
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${riskData.badgeColor}`}>
            {riskData.level}
          </span>
        )}
        {showProgressBar && (
          <div className="flex-1">
            <Progress value={riskData.percentage} className="h-2">
              <div
                className="absolute inset-0 h-full rounded-full"
                style={{ 
                  width: `${riskData.percentage}%`,
                  backgroundColor: riskData.progressColor 
                }}
              />
            </Progress>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Risk Level Label */}
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium">Risk Level:</span>
        {showBadge && (
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${riskData.badgeColor}`}>
            {riskData.level}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      {showProgressBar && (
        <div className="relative">
          <Progress value={riskData.percentage} className="h-2">
            <div
              className="absolute inset-0 h-full rounded-full"
              style={{ 
                width: `${riskData.percentage}%`,
                backgroundColor: riskData.progressColor 
              }}
            />
          </Progress>

          {/* Markers for detailed view */}
          {showMarkers && (
            <>
              {/* Collateral Value Marker */}
              <div className="absolute right-0 top-0 flex flex-col items-center" style={{ transform: 'translateX(50%)' }}>
                <div className="h-4 w-0.5 bg-blue-500"></div>
                <div className="mt-1 text-xs text-blue-600 whitespace-nowrap hidden sm:block">Collateral Value</div>
                <div className="mt-1 text-xs text-blue-600 whitespace-nowrap sm:hidden">Collateral</div>
              </div>

              {/* Liquidation Marker */}
              <div className="absolute top-0 flex flex-col items-center" style={{ left: '80%', transform: 'translateX(-50%)' }}>
                <div className="h-4 w-0.5 bg-red-500"></div>
                <div className="mt-1 text-xs text-red-600 whitespace-nowrap">Liquidation</div>
              </div>
            </>
          )}

          {/* Risk Level Labels */}
          {/* <div className="flex justify-between mt-1 text-xs text-gray-500">
            <span>Safe</span>
            <span>Risk Increases →</span>
            <span>High Risk</span>
          </div> */}
        </div>
      )}
    </div>
  );
}; 
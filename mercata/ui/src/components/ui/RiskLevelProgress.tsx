import { Progress } from "@/components/ui/progress";

interface RiskLevelProgressProps {
  riskLevel: number;
}

const RiskLevelProgress = ({ riskLevel }: RiskLevelProgressProps) => {
  const getRiskColor = () => {
    if (riskLevel < 30) return "bg-green-500";
    if (riskLevel < 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getRiskText = () => {
    if (riskLevel < 30) return "Low";
    if (riskLevel < 70) return "Moderate";
    return "High";
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span>Risk Level:</span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
              riskLevel < 30
                ? "bg-green-50 text-green-700"
                : riskLevel < 70
                  ? "bg-yellow-50 text-yellow-700"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {getRiskText()}
          </span>
        </div>
      </div>

      <div className="relative">
        <Progress value={riskLevel} className="h-2">
          <div
            className={`absolute inset-0 ${getRiskColor()} h-full rounded-full`}
            style={{ width: `${riskLevel}%` }}
          />
        </Progress>

        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>Safe</span>
          <span>Risk Increases →</span>
          <span>Liquidation</span>
        </div>
      </div>
    </div>
  );
};

export default RiskLevelProgress; 
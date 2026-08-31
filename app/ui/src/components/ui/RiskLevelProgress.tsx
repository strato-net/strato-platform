import { Progress } from "@/components/ui/progress";

interface RiskLevelProgressProps {
  riskLevel: number;
}

const RiskLevelProgress = ({ riskLevel }: RiskLevelProgressProps) => {
  const getRiskColor = () => {
    if (riskLevel < 30) return "bg-success";
    if (riskLevel < 70) return "bg-warning";
    return "bg-destructive";
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
                ? "bg-success/15 text-success"
                : riskLevel < 70
                  ? "bg-warning/15 text-warning"
                  : "bg-destructive/15 text-destructive"
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

        <div className="flex justify-between mt-1 text-xs text-muted-foreground">
          <span>Safe</span>
          <span>Risk Increases →</span>
          <span>Liquidation</span>
        </div>
      </div>
    </div>
  );
};

export default RiskLevelProgress; 
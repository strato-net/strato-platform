import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLiquidationAlert, getRiskLevelColor } from '@/hooks/useLiquidationAlert';

interface LiquidationAlertBannerProps {
  className?: string;
}

const LiquidationAlertBanner = ({ className = '' }: LiquidationAlertBannerProps) => {
  const navigate = useNavigate();
  const alertState = useLiquidationAlert();

  if (!alertState.shouldShow) {
    return null;
  }

  const { riskLevel, healthFactor, message } = alertState;
  const colorClasses = getRiskLevelColor(riskLevel);

  const handleAddCollateral = () => {
    navigate('/dashboard/borrow?tab=borrow');
  };

  const handleRepayLoan = () => {
    navigate('/dashboard/borrow?tab=repay');
  };


  return (
    <div className={`mb-4 md:mb-6 ${className}`}>
      <div className={`${colorClasses} border rounded-lg px-4 py-3 flex items-start gap-3`}>
        <div className="flex-shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm md:text-base font-medium mb-2">
            {message}
          </p>
          {healthFactor !== null && (
            <p className="text-xs text-muted-foreground mb-3">
              Current Health Factor: <span className="font-semibold">{healthFactor.toFixed(2)}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCollateral}
              className="text-xs md:text-sm border-current hover:bg-current/10"
            >
              Add Collateral
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRepayLoan}
              className="text-xs md:text-sm border-current hover:bg-current/10"
            >
              Repay Loan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidationAlertBanner;

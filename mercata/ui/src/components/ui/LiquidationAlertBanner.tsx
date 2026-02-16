import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLiquidationAlert, getRiskLevelColor } from '@/hooks/useLiquidationAlert';

interface LiquidationAlertBannerProps {
  className?: string;
}

const LiquidationAlertBanner = ({ className = '' }: LiquidationAlertBannerProps) => {
  const navigate = useNavigate();
  const alertState = useLiquidationAlert();
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className={`mb-4 md:mb-6 ${className}`}>
      <div className={`${colorClasses} border rounded-lg overflow-hidden transition-all`}>
        {/* Header - Always visible */}
        <div className="px-4 py-3 flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm md:text-base font-medium">
              {message}
            </p>
          </div>
          <button
            onClick={toggleCollapse}
            className="flex-shrink-0 p-1 hover:bg-current/10 rounded transition-colors"
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Collapsible Content */}
        {!isCollapsed && (
          <div className="px-4 pb-3 pt-0">
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
        )}
      </div>
    </div>
  );
};

export default LiquidationAlertBanner;

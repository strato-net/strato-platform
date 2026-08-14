import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  useLiquidationAlert,
  getRiskLevelColor,
  LiquidationAlertState,
} from '@/hooks/useLiquidationAlert';
import { useCDPLiquidationAlert } from '@/hooks/useCDPLiquidationAlert';

export interface AlertAction {
  label: string;
  to: string;
}

interface LiquidationAlertBannerViewProps {
  alertState: LiquidationAlertState;
  actions: AlertAction[];
  className?: string;
}

// Presentational banner — takes the alert state and its action buttons as
// props so it can be reused by both the lending-pool and CDP alerts.
export const LiquidationAlertBannerView = ({
  alertState,
  actions,
  className = '',
}: LiquidationAlertBannerViewProps) => {
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!alertState.shouldShow) {
    return null;
  }

  const { riskLevel, healthFactor, message } = alertState;
  const colorClasses = getRiskLevelColor(riskLevel);

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
              {actions.map((action) => (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(action.to)}
                  className="text-xs md:text-sm border-current hover:bg-current/10"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const LENDING_ACTIONS: AlertAction[] = [
  { label: 'Add Collateral', to: '/dashboard/advanced?tab=borrow&subtab=borrow' },
  { label: 'Repay Loan', to: '/dashboard/advanced?tab=borrow&subtab=repay' },
];

const CDP_ACTIONS: AlertAction[] = [
  { label: 'Add Collateral', to: '/dashboard/advanced?tab=vault' },
  { label: 'Repay Debt', to: '/dashboard/advanced?tab=vault' },
];

interface LiquidationAlertBannerProps {
  className?: string;
}

// Lending-pool liquidation banner (default export preserves existing usages).
const LiquidationAlertBanner = ({ className = '' }: LiquidationAlertBannerProps) => {
  const alertState = useLiquidationAlert();
  return (
    <LiquidationAlertBannerView
      alertState={alertState}
      actions={LENDING_ACTIONS}
      className={className}
    />
  );
};

// CDP (vault) liquidation banner — driven by the worst vault health factor.
export const CDPLiquidationAlertBanner = ({ className = '' }: LiquidationAlertBannerProps) => {
  const alertState = useCDPLiquidationAlert();
  return (
    <LiquidationAlertBannerView
      alertState={alertState}
      actions={CDP_ACTIONS}
      className={className}
    />
  );
};

export default LiquidationAlertBanner;

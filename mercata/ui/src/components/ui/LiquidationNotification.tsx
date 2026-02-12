import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useLiquidationAlert } from '@/hooks/useLiquidationAlert';
import { useUser } from '@/context/UserContext';

const LiquidationNotification = () => {
  const navigate = useNavigate();
  const { isLoggedIn } = useUser();
  const alertState = useLiquidationAlert();
  const [isDismissed, setIsDismissed] = useState(false);

  if (!isLoggedIn) {
    return null;
  }

  const hasActiveAlert = alertState.shouldShow && !isDismissed;
  const { riskLevel, healthFactor } = alertState;

  const handleAddCollateral = () => {
    navigate('/dashboard/borrow?tab=borrow');
  };

  const handleRepayLoan = () => {
    navigate('/dashboard/borrow?tab=repay');
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative p-2 hover:bg-muted rounded-md transition-colors">
          <Bell className="w-5 h-5 md:w-6 md:h-6 text-foreground" />
          {hasActiveAlert && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[calc(100vw-1rem)] max-w-80 p-0 sm:w-72 md:w-80 ml-[50px] sm:ml-0" 
        align="end" 
        sideOffset={8}
        side="bottom"
        alignOffset={-12}
      >
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">Notifications</h3>
        </div>
        {hasActiveAlert ? (
          <div className="p-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-2">
              <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                riskLevel === 'critical' || riskLevel === 'high' ? 'bg-red-500' : 'bg-orange-500'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-medium text-foreground line-clamp-2">
                    {riskLevel === 'critical' ? 'Critical: Position liquidatable' : 
                     riskLevel === 'high' ? 'Warning: Near liquidation' : 
                     'Health factor low'}
                  </p>
                  <button
                    onClick={handleDismiss}
                    className="flex-shrink-0 p-0.5 hover:bg-muted rounded transition-colors"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
                {healthFactor !== null && (
                  <p className="text-xs text-muted-foreground mb-2">
                    HF: <span className="font-semibold">{healthFactor.toFixed(2)}</span>
                  </p>
                )}
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={handleAddCollateral}
                    className="text-xs px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                  >
                    Add Collateral
                  </button>
                  <button
                    onClick={handleRepayLoan}
                    className="text-xs px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                  >
                    Repay
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-center">
            <p className="text-xs text-muted-foreground">No notifications</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default LiquidationNotification;

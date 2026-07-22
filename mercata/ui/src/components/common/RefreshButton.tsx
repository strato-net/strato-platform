import { RefreshCw } from 'lucide-react';
import { Button } from 'antd';

interface RefreshButtonProps {
  onRefresh?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

const RefreshButton = ({ onRefresh, disabled, loading, className }: RefreshButtonProps) => {
  if (!onRefresh) return null;

  return (
    <Button
      type="default"
      icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
      onClick={onRefresh}
      disabled={disabled || loading}
      className={className || "flex items-center gap-2"}
    >
      Refresh
    </Button>
  );
};

export default RefreshButton;


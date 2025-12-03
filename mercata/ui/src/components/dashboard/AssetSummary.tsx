import { HelpCircle, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AssetSummaryProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
  onClick?: () => void;
  isActive?: boolean;
  isLoading?: boolean;
}

const AssetSummary = ({
  title,
  value,
  icon,
  color,
  tooltip,
  onClick,
  isActive = false,
  isLoading = false,
}: AssetSummaryProps) => {
  return (
    <div 
      className={`bg-card rounded-xl border-2 p-5 shadow-sm transition-all w-full h-full flex flex-col justify-center ${
        isActive ? 'border-blue-500 shadow-md' : 'border-border hover:shadow-md'
      } ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-1">
            <p className="text-muted-foreground text-sm">{title}</p>
            {tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 mt-1">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          ) : (
            <h3 className="text-2xl font-bold mt-1">{value}</h3>
          )}
        </div>

        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${color} transition-opacity`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
};

export default AssetSummary;

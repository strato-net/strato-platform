import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface AssetSummaryProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
  onClick?: () => void;
  isLoading?: boolean;
}

const AssetSummary = ({ title, value, icon, color, tooltip, onClick, isLoading }: AssetSummaryProps) => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-1">
            <p className="text-gray-500 text-sm">{title}</p>
            {tooltip && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs text-sm">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 mt-1">
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : (
            <h3 className="text-2xl font-bold mt-1">{value}</h3>
          )}
        </div>

        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${color} ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
          onClick={onClick}
        >
          {icon}
        </div>
      </div>
    </div>
  );
};

export default AssetSummary;

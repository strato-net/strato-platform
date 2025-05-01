
import { ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react';

interface AssetSummaryProps {
  title: string;
  value: string;
  change: number;
  icon: React.ReactNode;
  color: string;
}

const AssetSummary = ({ title, value, change, icon, color }: AssetSummaryProps) => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-500 text-sm">{title}</p>
          <h3 className="text-2xl font-bold mt-1">{value}</h3>
          
          {title !== "Borrowing" && (
            <div className={`flex items-center mt-2 ${
              change >= 0 ? 'text-green-500' : 'text-red-500'
            }`}>
              {change >= 0 ? (
                <TrendingUp size={16} className="mr-1" />
              ) : (
                <TrendingDown size={16} className="mr-1" />
              )}
              <span className="text-sm font-medium">{Math.abs(change)}%</span>
            </div>
          )}
          
          {title === "Borrowing" && (
            <div className="mt-2 flex items-center">
              <span className="text-xs text-gray-500 mr-2">Risk Level:</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                value === "$0.00" ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'
              }`}>
                {value === "$0.00" ? 'None' : 'Moderate'}
              </span>
            </div>
          )}
        </div>
        
        <div 
          className={`w-10 h-10 rounded-full flex items-center justify-center ${color}`}
        >
          {icon}
        </div>
      </div>
      
      <div className="mt-4 pt-3 border-t border-gray-100">
        <a href="#" className="text-xs flex items-center text-blue-500 hover:text-blue-600 font-medium">
          View Details <ArrowUpRight size={12} className="ml-1" />
        </a>
      </div>
    </div>
  );
};

export default AssetSummary;

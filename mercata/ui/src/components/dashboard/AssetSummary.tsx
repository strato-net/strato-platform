interface AssetSummaryProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

const AssetSummary = ({ title, value, icon, color }: AssetSummaryProps) => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-500 text-sm">{title}</p>
          <h3 className="text-2xl font-bold mt-1">{value}</h3>
        </div>
        
        <div 
          className={`w-10 h-10 rounded-full flex items-center justify-center ${color}`}
        >
          {icon}
        </div>
      </div>      
    </div>
  );
};

export default AssetSummary;

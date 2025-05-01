
import { ArrowUpRight, Plus } from 'lucide-react';
import { Button } from "../ui/button";

interface Asset {
  name: string;
  symbol: string;
  price: string;
  change: number;
  amount: string;
  value: string;
  iconUrl: string;
}

const AssetsList = () => {
  const assets: Asset[] = [
    {
      name: 'Gold',
      symbol: 'GOLDST',
      price: '$1,958.30',
      change: 0.34,
      amount: '0.5 oz',
      value: '$979.15',
      iconUrl: 'https://placekitten.com/100/100' // Placeholder for demo
    },
    {
      name: 'Silver',
      symbol: 'SILVST',
      price: '$24.75',
      change: -0.78,
      amount: '10 oz',
      value: '$247.50',
      iconUrl: 'https://placekitten.com/100/101' // Placeholder for demo
    },
    {
      name: 'Bridged Ethereum',
      symbol: 'ETHST',
      price: '$2,207.65',
      change: 3.45,
      amount: '0.75 ETH',
      value: '$1,655.74',
      iconUrl: 'https://placekitten.com/100/102' // Placeholder for demo
    },
    {
      name: 'STRATO Token',
      symbol: 'CATA',
      price: '$5.78',
      change: 12.34,
      amount: '250 CATA',
      value: '$1,445.00',
      iconUrl: 'https://placekitten.com/100/103' // Placeholder for demo
    }
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
      <div className="p-5 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">Your Assets</h2>
          <Button size="sm" className="bg-strato-blue hover:bg-strato-blue/90 text-white rounded-md flex items-center gap-1">
            <Plus size={16} />
            Add Deposits
          </Button>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Asset</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Price</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Change</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Holdings</th>
              <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assets.map((asset, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="py-4 px-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-8 w-8 rounded-full overflow-hidden">
                      <img 
                        src={asset.iconUrl} 
                        alt={asset.name} 
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="ml-3">
                      <p className="font-medium text-gray-900">{asset.name}</p>
                      <p className="text-gray-500 text-xs">{asset.symbol}</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-4 whitespace-nowrap text-right">
                  <p className="font-medium text-gray-900">{asset.price}</p>
                </td>
                <td className="py-4 px-4 whitespace-nowrap text-right">
                  <div className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    asset.change >= 0 
                      ? 'bg-green-50 text-green-600'
                      : 'bg-red-50 text-red-600'
                  }`}>
                    {asset.change >= 0 ? '+' : ''}{asset.change}%
                  </div>
                </td>
                <td className="py-4 px-4 whitespace-nowrap text-right">
                  <p className="font-medium text-gray-900">{asset.amount}</p>
                </td>
                <td className="py-4 px-4 whitespace-nowrap text-right">
                  <p className="font-medium text-gray-900">{asset.value}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="p-4 text-right border-t border-gray-100">
        <a href="#" className="text-sm text-blue-500 hover:text-blue-600 flex items-center justify-end">
          View All <ArrowUpRight size={14} className="ml-1" />
        </a>
      </div>
    </div>
  );
};

export default AssetsList;

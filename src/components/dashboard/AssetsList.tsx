
import { ArrowUpRight, Plus } from 'lucide-react';
import { Button } from "../ui/button";

interface Asset {
  name: string;
  symbol: string;
  price: number;
  priceString: string;
  change: number;
  amount: number;
  amountString: string;
  value: number;
  iconUrl: string;
}

interface AssetsListProps {
  userAssets: {
    usdst: number;
    goldst: number;
    cata: number;
    borrowed: number;
  };
}

const AssetsList = ({ userAssets }: AssetsListProps) => {
  // Create the assets data with the user's actual values
  const assets: Asset[] = [
    {
      name: 'Gold',
      symbol: 'GOLDST',
      price: 1958.30,
      priceString: '$1,958.30',
      change: 0.34,
      amount: userAssets.goldst,
      amountString: `${userAssets.goldst} oz`,
      value: userAssets.goldst * 1958.30,
      iconUrl: 'https://placekitten.com/100/100' // Placeholder for demo
    },
    {
      name: 'USD Stablecoin',
      symbol: 'USDST',
      price: 1.00,
      priceString: '$1.00',
      change: 0.01,
      amount: userAssets.usdst,
      amountString: `${userAssets.usdst} USDST`,
      value: userAssets.usdst,
      iconUrl: 'https://placekitten.com/100/104' // Placeholder for demo
    },
    {
      name: 'STRATO Token',
      symbol: 'CATA',
      price: 5.78,
      priceString: '$5.78',
      change: 12.34,
      amount: userAssets.cata,
      amountString: `${userAssets.cata.toFixed(2)} CATA`,
      value: userAssets.cata * 5.78,
      iconUrl: 'https://placekitten.com/100/103' // Placeholder for demo
    }
  ];

  // Filter out assets with 0 amounts
  const filteredAssets = assets.filter(asset => asset.amount > 0);

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
        {filteredAssets.length > 0 ? (
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
              {filteredAssets.map((asset, index) => (
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
                    <p className="font-medium text-gray-900">{asset.priceString}</p>
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
                    <p className="font-medium text-gray-900">{asset.amountString}</p>
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap text-right">
                    <p className="font-medium text-gray-900">${asset.value.toFixed(2)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-8 text-center text-gray-500">
            No assets found. Add some deposits to get started!
          </div>
        )}
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

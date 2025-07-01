
import { Link } from 'react-router-dom';
import {
  Card,
  CardContent
} from '@/components/ui/card';
import { ArrowUpRight } from 'lucide-react';
import { formatUnits } from 'ethers';

interface AssetCardProps {
  id: string;
  name: string;
  symbol: string;
  price: string;
  deposit: string;
}

const AssetCard = ({ id, name, symbol, price, deposit }: AssetCardProps) => {
  return (
    <Card className="h-full">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm"
              style={{ backgroundColor: "red" }}
            >
              {symbol?.slice(0, 2)}
            </div>
            <div>
              <h3 className="font-medium">{name}</h3>
              <p className="text-sm text-gray-500">{symbol}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Price</span>
              <span className="font-medium">{formatUnits(price.toLocaleString('fullwide', { useGrouping: false }),18)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Asset Deposits</span>
            <span className="font-medium">
              {deposit
                ? formatUnits(Number(deposit).toLocaleString('fullwide', { useGrouping: false }), 18)
                : "0.00"}
            </span>
          </div>
        </div>

        <Link
          to={`/dashboard/deposits/${id}`}
          className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm mt-2"
        >
          View Details <ArrowUpRight className="ml-1 h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
};

export default AssetCard;

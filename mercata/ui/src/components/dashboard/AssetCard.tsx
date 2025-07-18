import { Link } from 'react-router-dom';
import {
  Card,
  CardContent
} from '@/components/ui/card';
import { ArrowUpRight } from 'lucide-react';
import { formatUnits } from 'ethers';
import { formatNumberForMobile } from '@/lib/utils';

interface AssetCardProps {
  id: string;
  name: string;
  symbol: string;
  price: string;
  deposit: string;
  collateralBalance?: string;
  image?: string;
  customDecimals: number;
}

const AssetCard = ({ id, name, symbol, price, deposit, collateralBalance, image, customDecimals }: AssetCardProps) => {
  // Helper function to safely format Wei values
  const formatWeiValue = (value: string, decimals: number, isPrice = false): string => {
    if (!value || value === "0") return isPrice ? "$0.00" : "0.00";
    
    try {
      if (isPrice) {
        // Handle scientific notation for price
        const numPrice = parseFloat(value);
        const priceString = numPrice.toLocaleString('fullwide', { useGrouping: false, maximumFractionDigits: 0 });
        const priceInWei = BigInt(priceString);
        const priceInEther = formatUnits(priceInWei, 18);
        const finalPrice = parseFloat(priceInEther);
        return finalPrice > 0 ? `$${finalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
      } else {
        // Handle regular Wei values
        const formatted = formatUnits(BigInt(value), decimals);
        return formatNumberForMobile(formatted);
      }
    } catch (error) {
      console.log(`${symbol} formatting error:`, error);
      return isPrice ? "$0.00" : "0.00";
    }
  };

  const formattedPrice = formatWeiValue(price, 18, true);
  const formattedDeposit = formatWeiValue(deposit, customDecimals);
  const formattedCollateral = formatWeiValue(collateralBalance || "0", customDecimals);

  // Asset avatar component
  const AssetAvatar = () => (
    image ? (
      <img
        src={image}
        alt={symbol}
        className="w-10 h-10 rounded-full object-cover border"
      />
    ) : (
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm"
        style={{ backgroundColor: "red" }}
      >
        {symbol?.slice(0, 2)}
      </div>
    )
  );

  // Asset details rows
  const assetDetails = [
    { label: "Price", value: formattedPrice },
    { label: "User Balance", value: formattedDeposit },
    { label: "Collateral", value: formattedCollateral }
  ];

  return (
    <Card className="h-full">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <AssetAvatar />
            <div>
              <h3 className="font-medium">{name}</h3>
              <p className="text-sm text-gray-500">{symbol}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {assetDetails.map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span className="text-xs sm:text-sm text-gray-500">{label}</span>
              <span className="font-medium text-xs sm:text-sm">{value}</span>
            </div>
          ))}
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


import AssetCard from './AssetCard';

interface Asset {
  id: string;
  name: string;
  symbol: string;
  price: string;
  priceUSDT?: string;
  deposit: string; 
  image: string;
  description: string;
  color: string;
  logoText: string;
}

interface AssetsGridProps {
  assets: Asset[];
}

const AssetsGrid = ({ assets }: AssetsGridProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          id={asset.id}
          name={asset.name}
          symbol={asset.symbol}
          price={asset.price}
          deposit={asset.deposit}
          image={asset.image}
          color={asset.color}
          logoText={asset.logoText}
        />
      ))}
    </div>
  );
};

export default AssetsGrid;

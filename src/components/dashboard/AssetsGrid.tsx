
import { Token } from '@/interface';
import AssetCard from './AssetCard';


interface AssetsGridProps {
  assets: Token[];
  loading: boolean;
}

const AssetsGrid = ({ assets, loading }: AssetsGridProps) => {
  return (
    loading ?
      <div className="flex justify-center items-center h-12">
        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
      </div>
      :
      assets.length === 0 ?
        <div className='w-full flex justify-center items-center'>No data to show</div>
        :
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {assets.map((asset, id) => (
            <AssetCard
              key={id}
              id={asset?.token?.address}
              name={asset?.token?._name}
              symbol={asset?.token?._symbol}
              price={asset?.price || "0"}
              deposit={asset?.balance}
            />
          ))}
        </div>
  );
};

export default AssetsGrid;

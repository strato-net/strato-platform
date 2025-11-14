import { EarningAsset } from '@mercata/shared-types';
import AssetCard from './AssetCard';

interface AssetsGridProps {
  assets: EarningAsset[];
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
              id={asset?.address}
              name={asset?._name || ''}
              symbol={asset?._symbol || ''}
              price={asset?.price?.toString() || '0'}
              deposit={asset?.balance || '0'}
              collateralBalance={asset?.collateralBalance || '0'}
              image={asset.images?.[0]?.value}
              customDecimals={asset?.customDecimals || 18}
            />
          ))}
        </div>
  );
};

export default AssetsGrid;

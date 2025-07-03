import { Token } from '@/interface';
import AssetCard from './AssetCard';
import { useUser } from '@/context/UserContext';

interface AssetsGridProps {
  assets: Token[];
  loading: boolean;
}

const AssetsGrid = ({ assets, loading }: AssetsGridProps) => {
  const { userAddress } = useUser();

  // Helper to get user balance from balances array
  function getUserBalance(token: Token, userAddress: string | null): string {
    if (!userAddress) return '0';
    const entry = token.balances?.find(b => b.user.toLowerCase() === userAddress.toLowerCase());
    return entry ? entry.balance : '0';
  }

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
              deposit={getUserBalance(asset, userAddress)}
              image={asset.images?.[0]?.value}
              customDecimals={asset?.customDecimals || 18}
            />
          ))}
        </div>
  );
};

export default AssetsGrid;

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { Token } from '@/interface';
import { formatUnits } from 'ethers';

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Token | null>(null);
  const { userAddress } = useUser()
  const { tokens: assets, loading, fetchTokens } = useUserTokens()


  useEffect(() => {
    fetchTokens(userAddress)
  }, [userAddress])

  useEffect(() => {
    // Find the asset with the matching id
    const foundAsset = assets.find(a => a?.address === id);
    if (foundAsset) {
      setAsset(foundAsset);
      document.title = `${foundAsset?.token?._name} | Asset Details`;
    }
  }, [id, assets]);

  if (!asset) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <DashboardSidebar />
        <div className="flex-1 ml-64">
          <DashboardHeader title="Asset Not Found" />
          {loading ?
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
            </div>
            :
            <main className="p-6">
              <div className="text-center py-12">
                <h2 className="text-2xl font-bold mb-4">Asset Not Found</h2>
                <p className="text-gray-600 mb-6">The asset you are looking for does not exist or has been removed.</p>
                <Link to="/dashboard/assets">
                  <Button>Back to Assets</Button>
                </Link>
              </div>
            </main>
          }
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title={`${asset?.token?._symbol} Details`} />

        <main className="p-6">
          <div className="mb-6">
            <Link to="/dashboard/assets" className="inline-flex items-center text-blue-600 hover:text-blue-800">
              <ChevronLeft size={16} className="mr-1" /> Back to Assets
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
            {/* Asset Summary Card */}
            <div className="lg:col-span-1">
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-blue-600">{asset?.token?._symbol}</p>
                      <CardTitle className="text-xl">{asset?.token?._name}</CardTitle>
                    </div>
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-sm font-bold overflow-hidden"
                      style={{ backgroundColor: asset?.token?.color || "#EF4444" }} // fallback to red if no color
                    >
                      {asset?.token?._symbol?.toUpperCase() || "N/A"}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="flex justify-center mb-6">
                    <div
                      className="w-32 h-32 rounded-full bg-white border-4 flex items-center justify-center overflow-hidden relative"
                    >
                      {asset?.token?.images?.length > 0 ? (
                        <img
                          src={asset.token.images[0].value}
                          alt={asset.token?._name}
                          className="w-full h-full object-contain"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-center text-sm font-semibold text-gray-500 p-2">
                          {asset?.token?._name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Current Price:</span>
                      <span className="font-medium">
                        {formatUnits(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), 18)}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Asset Deposits:</span>
                      <span className="font-medium">{formatUnits(asset?.balance?.toLocaleString("fullwide", { useGrouping: false }), 18)}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Owner:</span>
                      <span className="font-medium">{asset?.token?._owner}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Address:</span>
                      <span className="font-medium">{asset?.address}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts and Description */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>About {asset?.token?._name}</CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    <div
                      className="prose max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: asset?.token?.description }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AssetDetail;

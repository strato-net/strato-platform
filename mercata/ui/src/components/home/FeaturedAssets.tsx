import { TrendingUp, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import homepageGold from '@/assets/home/homepage-gold.png';
import homepageSilver from '@/assets/home/homepage-silver.png';
import homepageUsdst from '@/assets/home/homepage-usdst.png';

const FeaturedAssets = () => {
  const assets = [
    {
      id: 'gold',
      name: 'Gold',
      symbol: 'GOLDST',
      image: homepageGold,
      apy: '7.2%',
      tvl: '$2.1M',
      risk: 'Low',
      address: 'cdc93d30182125e05eec985b631c7c61b3f63ff0'
    },
    {
      id: 'silver',
      name: 'Silver',
      symbol: 'SILVST',
      image: homepageSilver,
      apy: '6.8%',
      tvl: '$1.5M',
      risk: 'Low',
      address: '2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94'
    },
    {
      id: 'usdst',
      name: 'USD Stablecoin',
      symbol: 'USDST',
      image: homepageUsdst,
      apy: '5.5%',
      tvl: '$3.2M',
      risk: 'Very Low',
      address: '937efa7e3a77e20bbdbd7c0d32b6514f368c1010'
    }
  ];

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Very Low': return 'bg-green-100 text-green-800';
      case 'Low': return 'bg-blue-100 text-blue-800';
      case 'Medium': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white py-20">
      <div className="container mx-auto px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Assets</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Discover our curated selection of yield-generating assets backed by real-world value
            </p>
          </div>

          {/* Asset Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {assets.map((asset) => (
              <div key={asset.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-lg transition-shadow">
                {/* Asset Image */}
                <div className="relative mb-4">
                  <img 
                    src={asset.image} 
                    alt={asset.name}
                    className="w-full h-auto object-contain rounded-lg"
                  />
                  <div className={`absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium ${getRiskColor(asset.risk)}`}>
                    {asset.risk} Risk
                  </div>
                </div>

                {/* Asset Info */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">{asset.name}</h3>
                    <span className="text-sm font-medium text-gray-500">{asset.symbol}</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center mb-1">
                      <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
                      <span className="text-xs text-gray-600">APY</span>
                    </div>
                    <div className="text-lg font-semibold text-green-600">{asset.apy}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center mb-1">
                      <Shield className="h-4 w-4 text-blue-600 mr-1" />
                      <span className="text-xs text-gray-600">TVL</span>
                    </div>
                    <div className="text-lg font-semibold text-gray-900">{asset.tvl}</div>
                  </div>
                </div>

                {/* Action Button */}
                <Link 
                  to={`/dashboard/deposits/${asset.address}`}
                  className="block w-full bg-strato-blue hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-semibold transition-colors text-center"
                >
                  Start Earning
                </Link>
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
          <div className="mt-16 text-center">
            <div className="bg-gradient-to-r from-strato-blue to-strato-orange rounded-xl p-8 text-white">
              <h3 className="text-2xl font-bold mb-4">Ready to Start Earning?</h3>
              <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
                Join thousands of users who are already earning stable returns on their digital and physical assets
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/dashboard" className="bg-white text-strato-blue px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors">
                  Launch STRATO
                </Link>
                <Link to="https://www.stratomercata.com/" className="border border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-colors">
                  Learn More
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeaturedAssets;
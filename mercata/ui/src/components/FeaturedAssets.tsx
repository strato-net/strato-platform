
import { useState } from 'react';
import AssetCard from './AssetCard';
import { Diamond } from 'lucide-react';

const FeaturedAssets = () => {
  const [activeTab, setActiveTab] = useState('all');

  const assets = [
    {
      id: 1,
      title: 'Gold 1 Troy Oz',
      type: 'STAKEABLE',
      image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?q=80&w=2070',
      logoColor: '#1F42AC',
      logoText: 'GOLDST',
      description: 'VAULTED BY BA GOLD ENTERPRISES INC.',
      category: 'metal'
    },
    {
      id: 2,
      title: 'Gold 1 Gram',
      type: 'STAKEABLE',
      image: 'https://images.unsplash.com/photo-1624365168297-0fa0f2434e7c?q=80&w=1000',
      logoColor: '#1F42AC',
      logoText: 'GOLDST',
      description: 'VAULTED BY BA GOLD ENTERPRISES INC.',
      category: 'metal'
    },
    {
      id: 3,
      title: 'Silver 1 Troy Oz',
      type: 'STAKEABLE',
      image: 'https://images.unsplash.com/photo-1589656966895-2f33e7653819?q=80&w=2070',
      logoColor: '#1F42AC',
      logoText: 'SILVST',
      description: 'VAULTED BY BA GOLD ENTERPRISES INC.',
      category: 'metal'
    },
    {
      id: 4,
      title: 'Bridged ETH',
      type: 'STAKEABLE',
      image: 'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?q=80&w=1892',
      logoColor: '#1F42AC',
      logoText: 'ETHST',
      description: 'ETH ON ETHEREUM MAINNET',
      category: 'crypto'
    }
  ];

  const filteredAssets = activeTab === 'all' ? assets : assets.filter(asset => asset.category === activeTab);

  return (
    <div className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="container mx-auto">
        <div className="flex items-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold">
            Featured Stakeable Assets <Diamond className="inline-block ml-2 h-6 w-6 text-strato-orange" />
          </h2>
        </div>
        
        <div className="mb-8">
          <div className="inline-flex p-1 bg-gray-100 rounded-lg">
            <button 
              className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'all' ? 'bg-white shadow-sm text-strato-blue' : 'text-gray-600 hover:text-strato-blue'}`}
              onClick={() => setActiveTab('all')}
            >
              All Assets
            </button>
            <button 
              className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'metal' ? 'bg-white shadow-sm text-strato-blue' : 'text-gray-600 hover:text-strato-blue'}`}
              onClick={() => setActiveTab('metal')}
            >
              Metals
            </button>
            <button 
              className={`px-4 py-2 text-sm font-medium rounded-md ${activeTab === 'crypto' ? 'bg-white shadow-sm text-strato-blue' : 'text-gray-600 hover:text-strato-blue'}`}
              onClick={() => setActiveTab('crypto')}
            >
              Crypto
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredAssets.map((asset) => (
            <AssetCard 
              key={asset.id}
              title={asset.title}
              type={asset.type}
              image={asset.image}
              logoColor={asset.logoColor}
              logoText={asset.logoText}
              description={asset.description}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default FeaturedAssets;


import { useState } from 'react';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Heart, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  available: boolean;
  soldOut?: boolean;
}

const Assets = () => {
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const { toast } = useToast();

  const assets: Asset[] = [
    {
      id: '1',
      name: 'GOLDST',
      symbol: 'GOLDST',
      price: '$3349.99',
      priceUSDT: '3349.99 USDT',
      deposit: '$71,800.37',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'GOLDST is a secure, blockchain-based gold investment product',
      color: '#DAA520',
      logoText: 'G',
      available: true
    },
    {
      id: '2',
      name: 'Ethereum Staking Token',
      symbol: 'ETHST',
      price: '$1838.78',
      priceUSDT: '1838.78 USDT',
      deposit: '$121,438.08',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'Ethereum Staking on Mercata',
      color: '#3671E3',
      logoText: 'ETH',
      available: true
    },
    {
      id: '3',
      name: 'Silver - Fractional',
      symbol: 'Silver',
      price: '$33.84',
      priceUSDT: '33.84 USDT',
      deposit: '$135,089.70',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'Silver offers the benefits of being a safe haven asset',
      color: '#C0C0C0',
      logoText: 'AG',
      available: true
    },
    {
      id: '4',
      name: 'WBTCST',
      symbol: 'WBTCST',
      price: '$96291.19',
      priceUSDT: '96291.19 USDT',
      deposit: '$58,670.02',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'WBTCST is a digital asset on STRATO',
      color: '#F7931A',
      logoText: 'BTC',
      available: true
    },
    {
      id: '5',
      name: 'USDTST',
      symbol: 'USDTST',
      price: 'No Price Available',
      deposit: '$2.71',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'USDTST is a digital asset on STRATO',
      color: '#26A17B',
      logoText: 'T',
      available: false,
      soldOut: true
    },
    {
      id: '6',
      name: 'USDCST',
      symbol: 'USDCST',
      price: 'No Price Available',
      deposit: '$9.12',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'USDCST is a digital asset on STRATO',
      color: '#2775CA',
      logoText: '$',
      available: false,
      soldOut: true
    },
    {
      id: '7',
      name: 'PAXGST',
      symbol: 'PAXGST',
      price: 'No Price Available',
      deposit: '$7.44',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'PAXGST is a digital asset on STRATO',
      color: '#F2C94C',
      logoText: 'PAX',
      available: false,
      soldOut: true
    }
  ];

  const handleConnectWallet = () => {
    toast({
      title: "Wallet Connected",
      description: "Your Ethereum wallet has been connected successfully.",
    });
    setIsWalletConnected(true);
  };

  const toggleFavorite = (assetId: string) => {
    setFavorites(prev => 
      prev.includes(assetId) 
        ? prev.filter(id => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleBuyNow = (asset: Asset) => {
    if (!isWalletConnected) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: `${asset.name} Purchase`,
      description: `You're about to purchase ${asset.name}.`,
    });
  };

  const handleBridge = (asset: Asset) => {
    if (!isWalletConnected) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: `${asset.name} Bridge`,
      description: `You're about to bridge ${asset.name}.`,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Assets" />
        
        <main className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Available Assets</h2>
            
            {!isWalletConnected ? (
              <Button 
                onClick={handleConnectWallet}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Wallet size={16} />
                Connect Ethereum Wallet
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium">Wallet Connected</span>
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {assets.map((asset) => (
              <Card key={asset.id} className="overflow-hidden border border-gray-200 shadow-sm">
                <div className="relative">
                  <button 
                    className="absolute right-2 top-2 p-1 rounded-full bg-white/80 hover:bg-white z-10"
                    onClick={() => toggleFavorite(asset.id)}
                  >
                    <Heart 
                      size={18} 
                      className={favorites.includes(asset.id) ? "fill-red-500 text-red-500" : "text-gray-400"}
                    />
                  </button>
                  
                  <div className="h-48 bg-gray-100 flex items-center justify-center relative">
                    <div 
                      className="w-24 h-24 rounded-full bg-white border-4 flex items-center justify-center overflow-hidden"
                      style={{ borderColor: asset.color }}
                    >
                      <img 
                        src={asset.image} 
                        alt={asset.name} 
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div 
                      className="absolute top-2 right-2 w-12 h-12 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: asset.color }}
                    >
                      {asset.logoText}
                    </div>
                    
                    {asset.soldOut && (
                      <div className="absolute bottom-2 right-2 bg-red-500 text-white text-xs font-bold py-1 px-2 rounded">
                        Sold Out
                      </div>
                    )}
                  </div>
                </div>
                
                <CardHeader className="pb-2">
                  <div className="text-sm font-semibold text-blue-600">{asset.symbol}</div>
                  <CardTitle className="text-lg">{asset.name}</CardTitle>
                </CardHeader>
                
                <CardContent className="pb-1">
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Price:</span>
                      <span className="font-medium">
                        {asset.price}
                        {asset.priceUSDT && (
                          <span className="text-xs text-gray-400 ml-1">({asset.priceUSDT})</span>
                        )}
                      </span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Asset Deposit:</span>
                      <span className="font-medium">{asset.deposit}</span>
                    </div>
                    
                    <div className="text-sm text-gray-600">{asset.description}</div>
                    
                    <div className="flex items-center">
                      <div className="w-full">
                        <Input 
                          type="number" 
                          placeholder="0.01"
                          className="text-right" 
                          disabled={!asset.available || !isWalletConnected}
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
                
                <CardFooter className="flex gap-2 pt-2">
                  <Button 
                    className="flex-1" 
                    onClick={() => handleBuyNow(asset)}
                    disabled={!asset.available || !isWalletConnected}
                  >
                    Buy Now
                  </Button>
                  
                  <Button 
                    variant="secondary" 
                    className="flex-1"
                    onClick={() => handleBridge(asset)}
                    disabled={!isWalletConnected}
                  >
                    Bridge
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Assets;


import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import AssetSummary from '@/components/dashboard/AssetSummary';
import AssetsGrid from '@/components/dashboard/AssetsGrid';
import { Coins, ChartBar } from 'lucide-react';

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

const Assets = () => {
  // Asset data
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
      logoText: 'G'
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
      logoText: 'ETH'
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
      logoText: 'AG'
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
      logoText: 'BTC'
    },
    {
      id: '5',
      name: 'WETHST',
      symbol: 'WETHST',
      price: 'No Price Available',
      deposit: '$0.00',
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'WETHST is a digital asset on STRATO',
      color: '#627EEA',
      logoText: 'ETH'
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
      logoText: '$'
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
      logoText: 'PAX'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Assets" />
        
        <main className="p-6">
          {/* Asset Summary */}
          <div className="mb-8">
            <AssetSummary 
              title="Total Assets" 
              value="$386,787.71"
              change={4.2}
              icon={<Coins className="text-white" size={18} />}
              color="bg-purple-500"
            />
          </div>
          
          {/* Assets List */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Available Assets</CardTitle>
              <CardDescription>
                View and manage all your assets in one place.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AssetsGrid assets={assets} />
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default Assets;

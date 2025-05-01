
import { useState } from 'react';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import BorrowingSection from '../components/dashboard/BorrowingSection';
import { Button } from '@/components/ui/button';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle
} from '@/components/ui/card';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Heart, PiggyBank } from 'lucide-react';
import BorrowAssetModal from '@/components/dashboard/BorrowAssetModal';

interface Asset {
  id: string;
  name: string;
  symbol: string;
  price: string;
  priceUSDT?: string;
  deposit: string;
  depositValue: number; // Added for sorting
  image: string;
  description: string;
  color: string;
  logoText: string;
  borrowPercentage: number;
  available: boolean;
}

const Borrow = () => {
  const [isWalletConnected, setIsWalletConnected] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const { toast } = useToast();

  // Asset data with borrowing percentages
  const assets: Asset[] = [
    {
      id: '1',
      name: 'GOLDST',
      symbol: 'GOLDST',
      price: '$3349.99',
      priceUSDT: '3349.99 USDT',
      deposit: '$71,800.37',
      depositValue: 71800.37,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'GOLDST is a secure, blockchain-based gold investment product',
      color: '#DAA520',
      logoText: 'G',
      borrowPercentage: 50, // Metal - 50%
      available: true
    },
    {
      id: '2',
      name: 'Ethereum Staking Token',
      symbol: 'ETHST',
      price: '$1838.78',
      priceUSDT: '1838.78 USDT',
      deposit: '$121,438.08',
      depositValue: 121438.08,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'Ethereum Staking on Mercata',
      color: '#3671E3',
      logoText: 'ETH',
      borrowPercentage: 30, // Crypto - 30%
      available: true
    },
    {
      id: '3',
      name: 'Silver - Fractional',
      symbol: 'Silver',
      price: '$33.84',
      priceUSDT: '33.84 USDT',
      deposit: '$135,089.70',
      depositValue: 135089.70,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'Silver offers the benefits of being a safe haven asset',
      color: '#C0C0C0',
      logoText: 'AG',
      borrowPercentage: 50, // Metal - 50%
      available: true
    },
    {
      id: '4',
      name: 'WBTCST',
      symbol: 'WBTCST',
      price: '$96291.19',
      priceUSDT: '96291.19 USDT',
      deposit: '$58,670.02',
      depositValue: 58670.02,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'WBTCST is a digital asset on STRATO',
      color: '#F7931A',
      logoText: 'BTC',
      borrowPercentage: 30, // Crypto - 30%
      available: true
    },
    {
      id: '6',
      name: 'USDCST',
      symbol: 'USDCST',
      price: 'No Price Available',
      deposit: '$9.12',
      depositValue: 9.12,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'USDCST is a digital asset on STRATO',
      color: '#2775CA',
      logoText: '$',
      borrowPercentage: 90, // Stablecoin - 90%
      available: true
    },
    {
      id: '7',
      name: 'PAXGST',
      symbol: 'PAXGST',
      price: 'No Price Available',
      deposit: '$7.44',
      depositValue: 7.44,
      image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
      description: 'PAXGST is a digital asset on STRATO',
      color: '#F2C94C',
      logoText: 'PAX',
      borrowPercentage: 50, // Gold-backed - 50%
      available: true
    }
  ];

  // Sort assets by deposit value (highest first)
  const sortedAssets = [...assets].sort((a, b) => b.depositValue - a.depositValue);

  const handleBorrow = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsBorrowModalOpen(true);
  };

  const closeBorrowModal = () => {
    setIsBorrowModalOpen(false);
    setSelectedAsset(null);
  };

  const executeBorrow = (asset: Asset, amount: number) => {
    toast({
      title: "Borrow Initiated",
      description: `You borrowed ${amount} USDT against your ${asset.name}.`,
    });
    setIsBorrowModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title="Borrow" />
        
        <main className="p-6">
          {/* Your Loans Section */}
          <div className="mb-8">
            <BorrowingSection />
          </div>
          
          {/* Assets Table */}
          <Card>
            <CardHeader>
              <CardTitle>Borrow Against Your Assets</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Your Deposit</TableHead>
                    <TableHead>LTV</TableHead>
                    <TableHead>Available to Borrow</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAssets.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs"
                            style={{ backgroundColor: asset.color }}
                          >
                            {asset.logoText}
                          </div>
                          <div>
                            <div className="font-medium">{asset.name}</div>
                            <div className="text-xs text-gray-500">{asset.symbol}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{asset.deposit}</TableCell>
                      <TableCell>{asset.borrowPercentage}%</TableCell>
                      <TableCell>
                        ${(asset.depositValue * asset.borrowPercentage / 100).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </TableCell>
                      <TableCell>
                        <Button 
                          size="sm" 
                          onClick={() => handleBorrow(asset)}
                          className="flex items-center gap-1"
                        >
                          <PiggyBank size={16} />
                          Borrow
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>
      
      {/* Borrow Modal */}
      {selectedAsset && (
        <BorrowAssetModal 
          asset={selectedAsset}
          isOpen={isBorrowModalOpen}
          onClose={closeBorrowModal}
          onBorrow={(amount) => executeBorrow(selectedAsset, amount)}
        />
      )}
    </div>
  );
};

export default Borrow;

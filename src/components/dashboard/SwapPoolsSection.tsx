
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, CircleArrowDown, CircleArrowUp, Search } from "lucide-react";
import { Link } from 'react-router-dom';
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription 
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";

interface SwapPool {
  id: string;
  name: string;
  token1: string;
  token2: string;
  liquidity: string;
  volume24h: string;
  apy: string;
  token1Color: string;
  token2Color: string;
  token1Logo: string;
  token2Logo: string;
}

interface DepositFormValues {
  amount: string;
  token: string;
}

const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<SwapPool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);

  const form = useForm<DepositFormValues>({
    defaultValues: {
      amount: '',
      token: 'token1'
    },
  });

  // Mock data for swap pools
  const swapPools: SwapPool[] = [
    {
      id: '1',
      name: 'GOLDST/USDST',
      token1: 'GOLDST',
      token2: 'USDST',
      liquidity: '$2,134,567.89',
      volume24h: '$345,678.12',
      apy: '8.45%',
      token1Color: '#DAA520',
      token2Color: '#2775CA',
      token1Logo: 'G',
      token2Logo: '$'
    },
    {
      id: '2',
      name: 'ETHST/USDST',
      token1: 'ETHST',
      token2: 'USDST',
      liquidity: '$4,567,891.23',
      volume24h: '$678,912.34',
      apy: '7.62%',
      token1Color: '#3671E3',
      token2Color: '#2775CA',
      token1Logo: 'ETH',
      token2Logo: '$'
    },
    {
      id: '3',
      name: 'WBTCST/USDST',
      token1: 'WBTCST',
      token2: 'USDST',
      liquidity: '$6,789,123.45',
      volume24h: '$891,234.56',
      apy: '6.38%',
      token1Color: '#F7931A',
      token2Color: '#2775CA',
      token1Logo: 'BTC',
      token2Logo: '$'
    },
    {
      id: '4',
      name: 'ETHST/WBTCST',
      token1: 'ETHST',
      token2: 'WBTCST',
      liquidity: '$1,234,567.89',
      volume24h: '$234,567.89',
      apy: '5.21%',
      token1Color: '#3671E3',
      token2Color: '#F7931A',
      token1Logo: 'ETH',
      token2Logo: 'BTC'
    }
  ];

  const handleOpenDepositModal = (pool: SwapPool) => {
    setSelectedPool(pool);
    setIsDepositModalOpen(true);
  };

  const handleCloseDepositModal = () => {
    setIsDepositModalOpen(false);
    setSelectedPool(null);
  };

  const handleDepositSubmit = (values: DepositFormValues) => {
    console.log('Deposit values:', values);
    // Here you would handle the actual deposit functionality
    handleCloseDepositModal();
  };

  // Filter pools based on search query
  const filteredPools = swapPools.filter(pool => 
    pool.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search pairs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 gap-4">
        {filteredPools.map((pool) => (
          <Card key={pool.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex items-center -space-x-2 mr-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                      style={{ backgroundColor: pool.token1Color }}
                    >
                      {pool.token1Logo}
                    </div>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                      style={{ backgroundColor: pool.token2Color }}
                    >
                      {pool.token2Logo}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-medium">{pool.name}</h3>
                    <div className="flex items-center text-xs text-gray-500 mt-1">
                      <span>Liquidity: {pool.liquidity}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded-md font-medium">
                      APY: {pool.apy}
                    </span>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      size="sm" 
                      className="bg-strato-purple hover:bg-strato-purple/90"
                      onClick={() => handleOpenDepositModal(pool)}
                    >
                      <CircleArrowDown className="mr-1 h-4 w-4" />
                      Deposit
                    </Button>
                    <Button size="sm" variant="outline" className="border-strato-purple text-strato-purple hover:bg-strato-purple/10">
                      <ArrowLeftRight className="mr-1 h-4 w-4" />
                      Swap
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Deposit Modal */}
      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Deposit Liquidity</DialogTitle>
            <DialogDescription>
              Add liquidity to the {selectedPool?.name} pool to earn {selectedPool?.apy} APY.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {/* First Token */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Amount</span>
                  <span className="text-sm text-gray-500">
                    Balance: 0.00
                  </span>
                </div>
                <div className="flex items-center">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                    {...form.register('amount')}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: selectedPool.token1Color }}
                        >
                          {selectedPool.token1Logo}
                        </div>
                        <span className="font-medium">{selectedPool?.token1}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="text-xs text-gray-500 mt-1"
                >
                  Max
                </Button>
              </div>
              
              {/* Second Token */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Amount</span>
                  <span className="text-sm text-gray-500">
                    Balance: 0.00
                  </span>
                </div>
                <div className="flex items-center">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 h-auto focus-visible:ring-0"
                    disabled
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: selectedPool.token2Color }}
                        >
                          {selectedPool.token2Logo}
                        </div>
                        <span className="font-medium">{selectedPool?.token2}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Exchange rate</span>
                <span className="font-medium">
                  {selectedPool && `1 ${selectedPool.token1} = 350 ${selectedPool.token2}`}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">Share of pool</span>
                <span className="font-medium">0.00%</span>
              </div>
            </div>
            
            <div className="pt-2">
              <Button type="submit" className="w-full bg-strato-purple hover:bg-strato-purple/90">
                Confirm Deposit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SwapPoolsSection;

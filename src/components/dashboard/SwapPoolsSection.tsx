
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Swap, CircleArrowUp, CircleArrowDown } from "lucide-react";
import { Link } from 'react-router-dom';

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

const SwapPoolsSection = () => {
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

  return (
    <div>
      <div className="grid grid-cols-1 gap-4">
        {swapPools.map((pool) => (
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
                    <div className="flex items-center text-xs text-gray-500 mt-1 space-x-2">
                      <span>Liquidity: {pool.liquidity}</span>
                      <span>•</span>
                      <span>Volume 24h: {pool.volume24h}</span>
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
                    <Button size="sm" className="bg-strato-purple hover:bg-strato-purple/90">
                      <CircleArrowDown className="mr-1 h-4 w-4" />
                      Deposit
                    </Button>
                    <Button size="sm" variant="outline" className="border-strato-purple text-strato-purple hover:bg-strato-purple/10">
                      <Swap className="mr-1 h-4 w-4" />
                      Swap
                    </Button>
                    <Link to={`/dashboard/pools/${pool.id}`}>
                      <Button size="sm" variant="ghost">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default SwapPoolsSection;

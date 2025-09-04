import React, { useState } from 'react';
import MintWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const ExchangeCart = () => {
  const [showLiquidations, setShowLiquidations] = useState(false);

  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="mint" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="mint">Mint</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
        </TabsList>
        <TabsContent value="mint">
          {showLiquidations ? (
            <LiquidationsView onBack={() => setShowLiquidations(false)} />
          ) : (
            <div className="space-y-6">
              {/* Liquidations Button */}
              <div className="flex justify-end">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowLiquidations(true)}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  Liquidations
                </Button>
              </div>
              
              <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
                <MintWidget />
              </div>
              <VaultsList />
            </div>
          )}
        </TabsContent>
        <TabsContent value="bridge">
          <BridgeWidget />
        </TabsContent>
        <TabsContent value="swap">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <SwapWidget />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 
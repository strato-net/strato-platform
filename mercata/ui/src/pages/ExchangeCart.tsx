import React, { useState } from 'react';
import CDPBorrowWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import MintWidget from '../components/mint/MintWidget'; // Bridge deposit widget
import WithdrawWidget from '../components/mint/WithdrawWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

const ExchangeCart = () => {
  const [showLiquidations, setShowLiquidations] = useState(false);
  const [convertAction, setConvertAction] = useState<'deposit' | 'withdraw' | null>(null);

  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="bridge" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cdp">Borrow</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="usdc" className="relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="flex items-center gap-1 cursor-pointer">
                  Convert
                  <ChevronDown className="h-3 w-3" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-32">
                <DropdownMenuItem onClick={() => setConvertAction('deposit')}>
                  Deposit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setConvertAction('withdraw')}>
                  Withdraw
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="cdp">
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
                <CDPBorrowWidget />
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
        
        <TabsContent value="usdc">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            {convertAction === 'deposit' && (
              <div>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-center">Convert to USDST</h3>
                  <p className="text-sm text-gray-600 text-center">Bridge USDC/USDT and mint USDST</p>
                </div>
                <MintWidget />
              </div>
            )}
            {convertAction === 'withdraw' && (
              <div>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-center">Redeem to USDC/USDT</h3>
                  <p className="text-sm text-gray-600 text-center">Redeem USDST back to USDC/USDT</p>
                </div>
                <WithdrawWidget />
              </div>
            )}
            {!convertAction && (
              <div className="text-center py-8">
                <h3 className="text-lg font-semibold mb-2">Select Action</h3>
                <p className="text-gray-500">Please select Deposit or Withdraw from the dropdown above</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 
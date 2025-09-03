import MintWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ExchangeCart = () => {
  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="mint" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="mint">Mint</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
        </TabsList>
        <TabsContent value="mint">
          <div className="space-y-6">
            <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
              <MintWidget />
            </div>
            <VaultsList />
          </div>
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
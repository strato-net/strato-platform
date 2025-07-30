import { DepositForm } from '@/components/dashboard/DepositModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Suspense } from 'react';
import { SwapWidget as LazySwapWidget, BridgeWidget as LazyBridgeWidget, ModalLoadingFallback } from '@/components/lazy/components';

const ExchangeCart = () => {
  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="buy" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="buy">Buy</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
        </TabsList>
        <TabsContent value="buy">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <DepositForm />
          </div>
        </TabsContent>
        <TabsContent value="bridge">
          <Suspense fallback={<ModalLoadingFallback />}>
            <LazyBridgeWidget />
          </Suspense>
        </TabsContent>
        <TabsContent value="swap">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <Suspense fallback={<ModalLoadingFallback />}>
              <LazySwapWidget />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 
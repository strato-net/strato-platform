import { DepositForm } from '@/components/dashboard/DepositModal';
import BridgeWidget from '@/components/bridge/BridgeWidget';
import SwapWidget from '@/components/swap/SwapWidget';
import MintWidget from '@/components/mint/MintWidget';
import WithdrawWidget from '../components/mint/WithdrawWidget';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ExchangeCart = () => {
  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <Tabs defaultValue="buy" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="buy">Buy</TabsTrigger>
          <TabsTrigger value="bridge">Bridge</TabsTrigger>
          <TabsTrigger value="swap">Swap</TabsTrigger>
          <TabsTrigger value="mint">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="buy">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <DepositForm />
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
        <TabsContent value="mint">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <MintWidget />
          </div>
        </TabsContent>
        <TabsContent value="withdraw">
          <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
            <WithdrawWidget />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExchangeCart; 
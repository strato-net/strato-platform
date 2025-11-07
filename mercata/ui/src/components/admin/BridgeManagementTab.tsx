import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightLeft } from 'lucide-react';
import WithdrawalManagement from './WithdrawalManagement';
import DepositManagement from './DepositManagement';

const BridgeManagementTab = () => {
  const [activeSubTab, setActiveSubTab] = useState('deposits');

  return (
    <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="deposits" className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4" />
          Deposits
        </TabsTrigger>
        <TabsTrigger value="withdrawals" className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4" />
          Withdrawals
        </TabsTrigger>
      </TabsList>
      <TabsContent value="deposits">
        <DepositManagement />
      </TabsContent>
      <TabsContent value="withdrawals">
        <WithdrawalManagement />
      </TabsContent>
    </Tabs>
  );
};

export default BridgeManagementTab;


import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Mint from './Mint/Mint';
import Burn from './Burn';
import DebtPosition from './DebtPosition';
import VaultsList from '@/components/cdp/VaultsList';

interface VaultsProps {
  refreshKey: number;
  onMintSuccess: () => void;
  onVaultActionSuccess: () => void;
}

const Vaults: React.FC<VaultsProps> = ({ refreshKey, onMintSuccess, onVaultActionSuccess }) => {
  const [mintBurnTab, setMintBurnTab] = useState<'mint' | 'burn'>('mint');

  return (
    <div className="space-y-6">
      {/* Mint/Burn Tabs */}
      <Tabs value={mintBurnTab} onValueChange={(v) => setMintBurnTab(v as 'mint' | 'burn')}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="mint">Mint</TabsTrigger>
          <TabsTrigger value="burn">Burn</TabsTrigger>
        </TabsList>

        <TabsContent value="mint" className="mt-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Column - Mint Section */}
            <div className="w-full lg:w-[60%]">
              <Mint
                onSuccess={onMintSuccess}
                refreshTrigger={refreshKey}
              />
            </div>

            {/* Right Column - Position and Vaults */}
            <div className="w-full lg:w-[40%] space-y-6">
              <DebtPosition refreshTrigger={refreshKey} />
              <VaultsList
                refreshTrigger={refreshKey}
                onVaultActionSuccess={onVaultActionSuccess}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="burn" className="mt-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Column - Burn Section */}
            <div className="w-full lg:w-[60%]">
              <Burn />
            </div>

            {/* Right Column - Position and Vaults */}
            <div className="w-full lg:w-[40%] space-y-6">
              <DebtPosition refreshTrigger={refreshKey} />
              <VaultsList
                refreshTrigger={refreshKey}
                onVaultActionSuccess={onVaultActionSuccess}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Vaults;


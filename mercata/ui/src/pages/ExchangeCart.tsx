import React from 'react';
import BridgeWidget from '@/components/bridge/BridgeWidget';

interface ExchangeCartProps {
  onVaultActionSuccess?: () => void; // Callback passed from parent (no longer used)
  initialTab?: string; // Initial tab to open (no longer used)
}

const ExchangeCart: React.FC<ExchangeCartProps> = () => {
  return (
    <div className="w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans">
      <BridgeWidget />
    </div>
  );
};

export default ExchangeCart; 
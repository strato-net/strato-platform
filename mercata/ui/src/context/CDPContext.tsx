import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { cdpService, VaultData } from '@/services/cdpService';
import { useUser } from '@/context/UserContext';

type CDPContextType = {
  vaults: VaultData[];
  loading: boolean;
  refreshVaults: () => Promise<void>;
  totalCDPDebt: string; // Total debt across all vaults in wei
};

const CDPContext = createContext<CDPContextType | undefined>(undefined);

export const CDPProvider = ({ children }: { children: React.ReactNode }) => {
  const [vaults, setVaults] = useState<VaultData[]>([]);
  const [loading, setLoading] = useState(false); // Start with false, will be set to true when fetching
  const { isLoggedIn } = useUser();

  const fetchVaults = useCallback(async () => {
    if (!isLoggedIn) {
      setVaults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const vaultData = await cdpService.getVaults();
      setVaults(vaultData);
    } catch (error) {
      console.error('Failed to fetch vaults:', error);
      setVaults([]);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  // Calculate total CDP debt across all vaults
  const totalCDPDebt = vaults.reduce((total, vault) => {
    const vaultDebt = BigInt(vault.debtAmount || '0');
    return (BigInt(total) + vaultDebt).toString();
  }, '0');

  useEffect(() => {
    fetchVaults();
  }, [fetchVaults]);

  return (
    <CDPContext.Provider value={{
      vaults,
      loading,
      refreshVaults: fetchVaults,
      totalCDPDebt
    }}>
      {children}
    </CDPContext.Provider>
  );
};

export const useCDP = () => {
  const context = useContext(CDPContext);
  if (!context) {
    throw new Error('useCDP must be used within a CDPProvider');
  }
  return context;
};

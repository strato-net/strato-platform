import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Vault } from '@/services/cdpService';
import { useUser } from '@/context/UserContext';
import { api } from '@/lib/axios';

type CDPContextType = {
  vaults: Vault[];
  loading: boolean;
  refreshVaults: () => Promise<void>;
  totalCDPDebt: string | undefined;
};

const CDPContext = createContext<CDPContextType | undefined>(undefined);

export const CDPProvider = ({ children }: { children: React.ReactNode }) => {
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(false); // Start with false, will be set to true when fetching
  const { isLoggedIn } = useUser();

  // ========== REFS ==========
  const vaultsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const vaultsAbortControllerRef = useRef<AbortController | null>(null);
  const hasFetchedVaults = useRef(false);

  const fetchVaults = useCallback(async (showLoading: boolean = false) => {
    if (!isLoggedIn) {
      setVaults([]);
      setLoading(false);
      return;
    }

    if (vaultsAbortControllerRef.current) {
      vaultsAbortControllerRef.current.abort();
    }

    vaultsAbortControllerRef.current = new AbortController();

    if (showLoading) {
    setLoading(true);
    }

    try {
      const response = await api.get<Vault[]>("/cdp/vaults", {
        signal: vaultsAbortControllerRef.current.signal
      });
      
      if (!vaultsAbortControllerRef.current.signal.aborted) {
        setVaults(response.data);
        hasFetchedVaults.current = true;
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        return;
      }
      console.error('Failed to fetch vaults:', error);
      if (!vaultsAbortControllerRef.current?.signal.aborted) {
      setVaults([]);
      }
    } finally {
      if (showLoading && !vaultsAbortControllerRef.current?.signal.aborted) {
      setLoading(false);
      }
    }
  }, [isLoggedIn]);

  // Calculate total CDP debt across all vaults
  const totalCDPDebt = hasFetchedVaults.current
    ? vaults.reduce((total, vault) => {
        const vaultDebt = BigInt(vault.debtAmount || '0');
        return (BigInt(total) + vaultDebt).toString();
      }, '0')
    : undefined;

  // ========== POLLING EFFECTS ==========
  // Vaults polling (60s interval)
  useEffect(() => {
    if (!isLoggedIn) return;

    fetchVaults(true);

    vaultsIntervalRef.current = setInterval(() => {
      fetchVaults(false);
    }, 60000);

    return () => {
      if (vaultsIntervalRef.current) {
        clearInterval(vaultsIntervalRef.current);
        vaultsIntervalRef.current = null;
      }
      if (vaultsAbortControllerRef.current) {
        vaultsAbortControllerRef.current.abort();
      }
    };
  }, [fetchVaults, isLoggedIn]);

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

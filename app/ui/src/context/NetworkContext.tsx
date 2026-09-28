import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '@/lib/axios';

// Testnet network ID
const TESTNET_NETWORK_ID = "114784819836269"; // Helium testnet

interface NetworkContextType {
  networkId: string | null;
  isTestnet: boolean;
  contactEnabled: boolean;
  loading: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

interface NetworkProviderProps {
  children: ReactNode;
  /** When provided, used instead of fetching config (avoids duplicate fetch when App already has config). */
  initialNetworkId?: string | null;
  initialContactEnabled?: boolean;
}

export const NetworkProvider = ({ children, initialNetworkId, initialContactEnabled }: NetworkProviderProps) => {
  const [networkId, setNetworkId] = useState<string | null>(initialNetworkId ?? null);
  const [contactEnabled, setContactEnabled] = useState(initialContactEnabled ?? false);
  const [loading, setLoading] = useState(typeof initialNetworkId === "undefined");

  useEffect(() => {
    if (typeof initialNetworkId !== "undefined") {
      setNetworkId(initialNetworkId ?? null);
      setContactEnabled(initialContactEnabled ?? false);
      setLoading(false);
      return;
    }
    const fetchConfig = async () => {
      try {
        const response = await api.get('/config');
        const data = response.data?.data;
        if (data?.networkId) setNetworkId(String(data.networkId));
        if (data?.contactEnabled) setContactEnabled(true);
      } catch (error) {
        console.error('Failed to fetch network config:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [initialNetworkId, initialContactEnabled]);

  const isTestnet = networkId === TESTNET_NETWORK_ID;

  return (
    <NetworkContext.Provider value={{ networkId, isTestnet, contactEnabled, loading }}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
};


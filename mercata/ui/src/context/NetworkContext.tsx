import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '@/lib/axios';

// Testnet network ID
const TESTNET_NETWORK_ID = "114784819836269"; // Helium testnet

interface NetworkContextType {
  networkId: string | null;
  isTestnet: boolean;
  loading: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get('/config');
        const data = response.data?.data;
        if (data?.networkId) {
          setNetworkId(String(data.networkId));
        }
      } catch (error) {
        console.error('Failed to fetch network config:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  const isTestnet = networkId === TESTNET_NETWORK_ID;

  return (
    <NetworkContext.Provider value={{ networkId, isTestnet, loading }}>
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


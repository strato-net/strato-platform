import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '@/lib/axios';

// Testnet network ID
const TESTNET_NETWORK_ID = "114784819836269"; // Helium testnet

interface NetworkContextType {
  networkId: string | null;
  creditCardTopUpAddress: string | null;
  isTestnet: boolean;
  contactEnabled: boolean;
  loading: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

interface NetworkProviderProps {
  children: ReactNode;
  /** When provided, used instead of fetching config (avoids duplicate fetch when App already has config). */
  initialNetworkId?: string | null;
  initialCreditCardTopUpAddress?: string | null;
  initialContactEnabled?: boolean;
}

export const NetworkProvider = ({ children, initialNetworkId, initialCreditCardTopUpAddress, initialContactEnabled }: NetworkProviderProps) => {
  const [networkId, setNetworkId] = useState<string | null>(initialNetworkId ?? null);
  const [creditCardTopUpAddress, setCreditCardTopUpAddress] = useState<string | null>(initialCreditCardTopUpAddress ?? null);
  const [contactEnabled, setContactEnabled] = useState(initialContactEnabled ?? false);
  const [loading, setLoading] = useState(typeof initialNetworkId === "undefined" && typeof initialCreditCardTopUpAddress === "undefined");

  useEffect(() => {
    if (typeof initialNetworkId !== "undefined" || typeof initialCreditCardTopUpAddress !== "undefined") {
      setNetworkId(initialNetworkId ?? null);
      setCreditCardTopUpAddress(initialCreditCardTopUpAddress ?? null);
      setContactEnabled(initialContactEnabled ?? false);
      setLoading(false);
      return;
    }
    const fetchConfig = async () => {
      try {
        const response = await api.get('/config');
        const data = response.data?.data;
        if (data?.networkId) setNetworkId(String(data.networkId));
        if (data?.creditCardTopUpAddress) setCreditCardTopUpAddress(String(data.creditCardTopUpAddress));
        if (data?.contactEnabled) setContactEnabled(true);
      } catch (error) {
        console.error('Failed to fetch network config:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [initialNetworkId, initialCreditCardTopUpAddress, initialContactEnabled]);

  const isTestnet = networkId === TESTNET_NETWORK_ID;

  return (
    <NetworkContext.Provider value={{ networkId, creditCardTopUpAddress, isTestnet, contactEnabled, loading }}>
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


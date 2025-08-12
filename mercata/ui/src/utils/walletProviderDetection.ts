// Utility to handle multiple wallet provider conflicts

interface EthereumProvider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  selectedProvider?: EthereumProvider;
  providers?: EthereumProvider[];
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export const detectWalletProviders = () => {
  const providers: { [key: string]: EthereumProvider } = {};
  
  // Check for MetaMask
  if (typeof window !== 'undefined' && (window as Window & { ethereum?: EthereumProvider }).ethereum) {
    const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    
    if (ethereum?.isMetaMask) {
      providers.metamask = ethereum;
    }
    
    // Check for Coinbase Wallet
    if (ethereum?.isCoinbaseWallet || ethereum?.selectedProvider?.isCoinbaseWallet) {
      providers.coinbase = ethereum.isCoinbaseWallet ? ethereum : ethereum.selectedProvider!;
    }
    
    // Check for multiple providers
    if (ethereum?.providers && Array.isArray(ethereum.providers)) {
      ethereum.providers.forEach((provider: EthereumProvider) => {
        if (provider.isMetaMask) {
          providers.metamask = provider;
        }
        if (provider.isCoinbaseWallet) {
          providers.coinbase = provider;
        }
      });
    }
  }
  
  return providers;
};

export const getPreferredProvider = () => {
  const providers = detectWalletProviders();
  
  // Return MetaMask if available, otherwise return any available provider
  if (providers.metamask) {
    return providers.metamask;
  }
  
  if (providers.coinbase) {
    return providers.coinbase;
  }
  
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
};
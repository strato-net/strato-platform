/**
 * Utility to handle wallet extension conflicts gracefully
 */

export const detectWalletConflict = (): boolean => {
  try {
    // Check if multiple wallet providers are trying to inject
    const globalWindow = window as any;
    
    // Common wallet provider properties
    const walletProviders = [
      'ethereum',
      'coinbaseWalletExtension', 
      'isMetaMask',
      'isCoinbaseWallet',
      'isRabby',
      'isBraveWallet',
      'isTrustWallet'
    ];
    
    let detectedProviders = 0;
    
    for (const provider of walletProviders) {
      if (globalWindow[provider] || (globalWindow.ethereum && globalWindow.ethereum[provider])) {
        detectedProviders++;
      }
    }
    
    // If more than one provider detected, there might be conflicts
    return detectedProviders > 1;
  } catch (error) {
    console.warn('Error detecting wallet conflicts:', error);
    return false;
  }
};

export const suppressWalletConflictErrors = () => {
  // Override the defineProperty for ethereum to prevent errors
  const originalDefineProperty = Object.defineProperty;
  
  try {
    Object.defineProperty = function(target, property, descriptor) {
      if (property === 'ethereum' && target === window) {
        // Check if ethereum is already defined
        const existingDescriptor = Object.getOwnPropertyDescriptor(target, property);
        if (existingDescriptor && !existingDescriptor.configurable) {
          console.warn('Ethereum provider already defined, skipping redefinition');
          return target;
        }
      }
      return originalDefineProperty.call(this, target, property, descriptor);
    };
  } catch (error) {
    console.warn('Could not override defineProperty:', error);
  }
  
  // Also suppress specific console errors related to wallet conflicts
  const originalConsoleError = console.error;
  console.error = function(...args) {
    const errorString = args.join(' ');
    
    // Suppress known wallet conflict errors
    if (
      errorString.includes('Cannot redefine property: ethereum') ||
      errorString.includes('Cannot set property ethereum') ||
      errorString.includes('MetaMask encountered an error setting the global Ethereum provider')
    ) {
      console.warn('Suppressed wallet conflict error:', errorString);
      return;
    }
    
    // Call original console.error for other errors
    originalConsoleError.apply(console, args);
  };
};

// Initialize wallet conflict handling
if (typeof window !== 'undefined') {
  suppressWalletConflictErrors();
}
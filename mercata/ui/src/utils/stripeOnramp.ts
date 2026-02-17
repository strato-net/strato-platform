/**
 * Stripe Crypto Onramp Utility
 * Based on: https://docs.stripe.com/crypto/onramp/stripe-hosted
 */

declare global {
  interface Window {
    StripeOnramp?: {
      Standalone: (options: StripeOnrampOptions) => {
        getUrl: () => string;
      };
    };
  }
}

export interface StripeOnrampOptions {
  source_currency?: 'usd' | 'eur';
  amount?: {
    source_amount?: string;
    destination_amount?: string;
  };
  destination_currencies?: string[];
  destination_networks?: string[];
  destination_network?: string;
  destination_currency?: string;
}

let scriptsLoaded = false;
let loadPromise: Promise<void> | null = null;

/**
 * Load Stripe onramp scripts dynamically
 * Scripts must be loaded from Stripe domains for PCI compliance
 */
export const loadStripeOnrampScripts = (): Promise<void> => {
  if (scriptsLoaded && window.StripeOnramp) {
    return Promise.resolve();
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    // Check if scripts are already in the DOM
    const existingStripeScript = document.querySelector('script[src*="js.stripe.com/clover/stripe.js"]');
    const existingOnrampScript = document.querySelector('script[src*="crypto-js.stripe.com"]');

    if (existingStripeScript && existingOnrampScript && window.StripeOnramp) {
      scriptsLoaded = true;
      resolve();
      return;
    }

    // Load Stripe.js script
    const stripeScript = document.createElement('script');
    stripeScript.src = 'https://js.stripe.com/clover/stripe.js';
    stripeScript.async = true;
    stripeScript.onload = () => {
      // Load crypto onramp script
      const onrampScript = document.createElement('script');
      onrampScript.src = 'https://crypto-js.stripe.com/crypto-onramp-outer.js';
      onrampScript.async = true;
      onrampScript.onload = () => {
        // Wait a bit for StripeOnramp to be available
        const checkStripeOnramp = setInterval(() => {
          if (window.StripeOnramp) {
            clearInterval(checkStripeOnramp);
            scriptsLoaded = true;
            resolve();
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkStripeOnramp);
          if (!window.StripeOnramp) {
            reject(new Error('StripeOnramp failed to load'));
          }
        }, 10000);
      };
      onrampScript.onerror = () => {
        reject(new Error('Failed to load Stripe crypto onramp script'));
      };
      document.head.appendChild(onrampScript);
    };
    stripeScript.onerror = () => {
      reject(new Error('Failed to load Stripe.js script'));
    };
    document.head.appendChild(stripeScript);
  });

  return loadPromise;
};

/**
 * Generate a redirect URL for the Stripe-hosted onramp
 * @param options Configuration options for the onramp
 * @returns Promise that resolves to the redirect URL
 */
export const generateStripeOnrampUrl = async (
  options: StripeOnrampOptions = {}
): Promise<string> => {
  try {
    // Load scripts if not already loaded
    await loadStripeOnrampScripts();

    if (!window.StripeOnramp) {
      throw new Error('StripeOnramp is not available');
    }

    // Default options
    const defaultOptions: StripeOnrampOptions = {
      source_currency: 'usd',
      destination_currencies: ['eth', 'usdc', 'btc'],
      destination_networks: ['ethereum', 'polygon', 'bitcoin'],
      destination_network: 'ethereum',
      destination_currency: 'eth',
      ...options,
    };

    // Create standalone onramp instance
    const standaloneOnramp = window.StripeOnramp.Standalone(defaultOptions);
    
    // Get the redirect URL
    const redirectUrl = standaloneOnramp.getUrl();
    
    return redirectUrl;
  } catch (error) {
    console.error('Error generating Stripe onramp URL:', error);
    throw error;
  }
};

/**
 * Redirect user to Stripe-hosted onramp
 * @param options Configuration options for the onramp
 */
export const redirectToStripeOnramp = async (options: StripeOnrampOptions = {}): Promise<void> => {
  try {
    const url = await generateStripeOnrampUrl(options);
    window.location.href = url;
  } catch (error) {
    console.error('Error redirecting to Stripe onramp:', error);
    throw error;
  }
};

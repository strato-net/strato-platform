import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { UserProvider } from "@/context/UserContext";
import { UserTokensProvider } from "@/context/UserTokensContext";
import { SwapProvider } from "@/context/SwapContext";
import { OracleProvider } from "@/context/OracleContext";
import { LendingProvider } from "./LendingContext";
import { TokenProvider } from "./TokenContext";
import { OnRampProvider } from "./OnRampContext";
import { TransactionProvider } from "@/context/TransactionContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./LiquidationContext";
import { ReactNode, lazy, Suspense } from "react";

// Lazy load non-critical providers
const LazyLiquidationProvider = lazy(() => import("./LiquidationContext").then(module => ({ default: module.LiquidationProvider })));
const LazyOnRampProvider = lazy(() => import("./OnRampContext").then(module => ({ default: module.OnRampProvider })));

interface AppProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
  wagmiConfig: any;
}

// Core providers that are needed immediately
const CoreProviders = ({ children }: { children: ReactNode }) => (
  <UserProvider>
    <UserTokensProvider>
      <LendingProvider>
        <SwapProvider>
          <OracleProvider>
            <TokenProvider>
              <TransactionProvider>
                <BridgeProvider>
                  {children}
                </BridgeProvider>
              </TransactionProvider>
            </TokenProvider>
          </OracleProvider>
        </SwapProvider>
      </LendingProvider>
    </UserTokensProvider>
  </UserProvider>
);

// Optional providers that can be loaded lazily
const OptionalProviders = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={null}>
    <LazyLiquidationProvider>
      <Suspense fallback={null}>
        <LazyOnRampProvider>
          {children}
        </LazyOnRampProvider>
      </Suspense>
    </LazyLiquidationProvider>
  </Suspense>
);

const AppProviders = ({ children, queryClient, wagmiConfig }: AppProvidersProps) => {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider>
          <CoreProviders>
            <OptionalProviders>
              {children}
            </OptionalProviders>
          </CoreProviders>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
};

export default AppProviders; 
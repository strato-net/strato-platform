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
import { ReactNode } from "react";

interface AppProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
  wagmiConfig: any;
}

const AppProviders = ({ children, queryClient, wagmiConfig }: AppProvidersProps) => {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider>
          <UserProvider>
            <UserTokensProvider>
              <LendingProvider>
                <SwapProvider>
                  <OracleProvider>
                    <TokenProvider>
                      <OnRampProvider>
                        <LiquidationProvider>
                          <TransactionProvider>
                            <BridgeProvider>
                              {children}
                            </BridgeProvider>
                          </TransactionProvider>
                        </LiquidationProvider>
                      </OnRampProvider>
                    </TokenProvider>
                  </OracleProvider>
                </SwapProvider>
              </LendingProvider>
            </UserTokensProvider>
          </UserProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
};

export default AppProviders; 
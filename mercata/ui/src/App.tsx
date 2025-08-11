import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import UsdstBalanceBox from "@/components/layouts/UsdstBalanceBox";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { mainnet, polygon, sepolia } from "wagmi/chains";
import {
  connectorsForWallets,
  RainbowKitProvider,
} from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import { UserProvider } from "@/context/UserContext";
import { UserTokensProvider } from "@/context/UserTokensContext";
import { SwapProvider } from "@/context/SwapContext";
import { OracleProvider } from "@/context/OracleContext";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Transfer from "./pages/Transfer";
import DepositsPage from "./pages/DepositsPage";
import AssetDetail from "./pages/AssetDetail";
import Pools from "./pages/Pools";
import ActivityFeed from "./pages/ActivityFeed";
import NotFound from "./pages/NotFound";

// Import dashboard components

import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import { coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import { LendingProvider } from "./context/LendingContext";
import { TokenProvider } from "./context/TokenContext";
import { OnRampProvider } from "./context/OnRampContext";
import { TransactionProvider } from "@/context/TransactionContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import Borrow from "./pages/Borrow";
import { getConfig } from "./lib/config";
import { useState, useEffect } from "react";

const queryClient = new QueryClient();

const App = () => {
  const [projectId, setProjectId] = useState('PROJECT_ID_UNSET');
  const [wagmiConfig, setWagmiConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configData = await getConfig();
        setProjectId(configData.projectId);
      } catch (error) {
        console.error('Failed to fetch config:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (!loading) {
      const appName = "Mercata";
      const chains = [mainnet, polygon, sepolia] as const;
      const transports = {
        [mainnet.id]: http(),
        [polygon.id]: http(),
        [sepolia.id]: http(),
      };

      const connectors = connectorsForWallets(
        [
          {
            groupName: "Recommended",
            wallets: [metaMaskWallet, coinbaseWallet, walletConnectWallet],
          },
        ],
        { projectId, appName }
      );

      const config = createConfig({
        connectors,
        chains,
        transports,
        ssr: true,
      });

      setWagmiConfig(config);
    }
  }, [projectId, loading]);

  if (loading || !wagmiConfig) {
    return <div>Loading configuration...</div>;
  }

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
                            <TooltipProvider>
                              <Toaster />
                              <BrowserRouter>
                                <UsdstBalanceBox />
                                <Routes>
                                  <Route path="/" element={<Index />} />
                                  <Route
                                    path="/dashboard"
                                    element={
                                      <ProtectedRoute>
                                        <Dashboard />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/swap"
                                    element={
                                      <ProtectedRoute>
                                        <SwapAsset />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/deposits"
                                    element={
                                      <ProtectedRoute>
                                        <DepositsPage />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/deposits/:id"
                                    element={
                                      <ProtectedRoute>
                                        <AssetDetail />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/borrow"
                                    element={
                                      <ProtectedRoute>
                                        <Borrow />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/pools"
                                    element={
                                      <ProtectedRoute>
                                        <Pools />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/activity"
                                    element={
                                      <ProtectedRoute>
                                        <ActivityFeed />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/transfer"
                                    element={
                                      <ProtectedRoute>
                                        <Transfer />
                                      </ProtectedRoute>
                                    }
                                  />
                                  <Route
                                    path="/dashboard/admin"
                                    element={
                                      <ProtectedRoute>
                                        <AdminRoute>
                                          <Admin />
                                        </AdminRoute>
                                      </ProtectedRoute>
                                    }
                                  />

                                  <Route
                                    path="/dashboard/bridge-transactions"
                                    element={
                                      <ProtectedRoute>
                                        <BridgeTransactionsPage />
                                      </ProtectedRoute>
                                    }
                                  />

                                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                                  <Route path="*" element={<NotFound />} />
                                </Routes>
                              </BrowserRouter>
                            </TooltipProvider>
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

export default App;


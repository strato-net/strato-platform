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
import { OracleProvider } from "@/context/OracleContext";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Transfer from "./pages/Transfer";
import DepositsPage from "./pages/DepositsPage";
import AssetDetail from "./pages/AssetDetail";
import Pools from "./pages/Pools";
import LendingPools from "./pages/LendingPools";
import SwapPools from "./pages/SwapPools";
import SafetyModule from "./pages/SafetyModule";
import Liquidations from "./pages/Liquidations";
import ActivityFeed from "./pages/ActivityFeed";
import NotFound from "./pages/NotFound";
import MercataStats from "./pages/MercataStats";
import LendingPoolBorrow from "./pages/LendingPoolBorrow";
import CDPVaults from "./pages/CDPVaults";

// Import dashboard components

import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import { coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import DashboardWrapper from "./components/layouts/DashboardWrapper";
import { LendingProvider } from "./context/LendingContext";
import { CDPProvider } from "./context/CDPContext";
import { TokenProvider } from "./context/TokenContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import { SafetyProvider } from "./context/SafetyContext";
import Borrow from "./pages/Borrow";
import { getConfig } from "./lib/config";
import { useState, useEffect } from "react";
import { initializeCsrfToken } from "./lib/csrf";

const queryClient = new QueryClient();

const App = () => {
  const [projectId, setProjectId] = useState('PROJECT_ID_UNSET');
  const [wagmiConfig, setWagmiConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Initialize CSRF token on app startup
  useEffect(() => {
    initializeCsrfToken();
  }, []);

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
              <CDPProvider>
                {/* <SwapProvider> */}
                <OracleProvider>
                  <TokenProvider>
                    <LiquidationProvider>
                      <SafetyProvider>
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
                                      <DashboardWrapper>
                                        <Dashboard />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/swap"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <SwapAsset />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/deposits"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <DepositsPage />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/deposits/:id"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <AssetDetail />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/borrow"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Borrow />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/borrow/lending"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <LendingPoolBorrow />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/borrow/cdp"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <CDPVaults />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/pools"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Pools />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/pools/lending"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <LendingPools />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/pools/swap"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <SwapPools />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/pools/safety"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <SafetyModule />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/pools/liquidations"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Liquidations />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/activity"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <ActivityFeed />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/transfer"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Transfer />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard/admin"
                                  element={
                                    <ProtectedRoute>
                                      <AdminRoute>
                                        <DashboardWrapper>
                                          <Admin />
                                        </DashboardWrapper>
                                      </AdminRoute>
                                    </ProtectedRoute>
                                  }
                                />

                                <Route
                                  path="/dashboard/bridge-transactions"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <BridgeTransactionsPage />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />

                                <Route
                                  path="/dashboard/stats"
                                  element={
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <MercataStats />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                  }
                                />

                                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                                <Route path="*" element={<NotFound />} />
                              </Routes>
                            </BrowserRouter>
                          </TooltipProvider>
                        </BridgeProvider>
                      </SafetyProvider>
                    </LiquidationProvider>
                  </TokenProvider>
                </OracleProvider>
                {/* </SwapProvider> */}
              </CDPProvider>
            </LendingProvider>
          </UserTokensProvider>
        </UserProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  </QueryClientProvider>
  );
};

export default App;


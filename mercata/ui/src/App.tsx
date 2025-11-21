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
import Advanced from "./pages/Advanced";
import ActivityFeed from "./pages/ActivityFeed";
import NotFound from "./pages/NotFound";
import MercataStats from "./pages/MercataStats";

// Import dashboard components

import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import WithdrawalsPage from "./pages/WithdrawalsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import { coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import DashboardWrapper from "./components/layouts/DashboardWrapper";
import { WithdrawalsProviders } from "./components/layouts/WithdrawalsProviders";
import { DepositsProviders } from "./components/layouts/DepositsProviders";
import { DashboardProviders } from "./components/layouts/DashboardProviders";
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
                {/* <SwapProvider> */}
                <OracleProvider>
                  <TokenProvider>
                    <LiquidationProvider>
                      <SafetyProvider>
                              <TooltipProvider>
                              <Toaster />
                            <BrowserRouter>
                              <UsdstBalanceBox />
                              <Routes>
                                <Route path="/" element={<Index />} />
                                <Route
                                  path="/dashboard"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Dashboard />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/swap"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <SwapAsset />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/deposits"
                                  element={
                                    <DepositsProviders>
                                    <ProtectedRoute>
                                        <DepositsPage />
                                    </ProtectedRoute>
                                    </DepositsProviders>
                                  }
                                />
                                <Route
                                  path="/deposits/:id"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <AssetDetail />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/borrow"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Borrow />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/advanced"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Advanced />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/activity"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <ActivityFeed />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/transfer"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <Transfer />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />
                                <Route
                                  path="/dashboard/admin"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <AdminRoute>
                                        <DashboardWrapper>
                                          <Admin />
                                        </DashboardWrapper>
                                      </AdminRoute>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />

                                <Route
                                  path="/bridge-transactions"
                                  element={
                                    <BridgeProvider>
                                    <ProtectedRoute>
                                        <BridgeTransactionsPage />
                                    </ProtectedRoute>
                                    </BridgeProvider>
                                  }
                                />

                                <Route
                                  path="/dashboard/stats"
                                  element={
                                    <DashboardProviders>
                                    <ProtectedRoute>
                                      <DashboardWrapper>
                                        <MercataStats />
                                      </DashboardWrapper>
                                    </ProtectedRoute>
                                    </DashboardProviders>
                                  }
                                />

                                <Route
                                  path="/withdrawals"
                                  element={
                                    <WithdrawalsProviders>
                                      <ProtectedRoute>
                                        <WithdrawalsPage />
                                      </ProtectedRoute>
                                    </WithdrawalsProviders>
                                  }
                                />

                                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                                <Route path="*" element={<NotFound />} />
                              </Routes>
                            </BrowserRouter>
                          </TooltipProvider>
                      </SafetyProvider>
                    </LiquidationProvider>
                  </TokenProvider>
                </OracleProvider>
                {/* </SwapProvider> */}
          </UserTokensProvider>
        </UserProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  </QueryClientProvider>
  );
};

export default App;


import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import UsdstBalanceBox from "@/components/layouts/UsdstBalanceBox";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Transport, WagmiProvider } from "wagmi";
import { mainnet, polygon, sepolia, base, baseSepolia } from "wagmi/chains";
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
import StratoStats from "./pages/StratoStats";
import Rewards from "./pages/Rewards";
import ReferFriend from "./pages/ReferFriend";
import Claim from "./pages/Claim";
import ReferralsManagement from "./pages/ReferralsManagement";

// Import dashboard components

import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import WithdrawalsPage from "./pages/WithdrawalsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import {
  coinbaseWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import { TokenProvider } from "./context/TokenContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import { SafetyProvider } from "./context/SafetyContext";
import { LendingProvider } from "@/context/LendingContext";
import { CDPProvider } from "@/context/CDPContext";
import { SwapProvider } from "@/context/SwapContext";
import { NetworkProvider } from "@/context/NetworkContext";
import Borrow from "./pages/Borrow";
import { getConfig } from "./lib/config";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { initializeCsrfToken, csrfOnRequest } from "./lib/csrf";


const queryClient = new QueryClient();

const App = () => {
  const [projectId, setProjectId] = useState("PROJECT_ID_UNSET");
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
        console.error("Failed to fetch config:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (!loading) {
      const appName = "Mercata";
      const chains = [mainnet, polygon, sepolia, base, baseSepolia] as const;
      const transports: Record<number, Transport> = Object.fromEntries(
        chains.map((chain) => [chain.id, http(`/api/rpc/${chain.id}`, {onFetchRequest: csrfOnRequest})])
      );

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
      <NetworkProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider>
        <UserProvider>
          <UserTokensProvider>
              <SwapProvider>
                <OracleProvider>
                  <TokenProvider>
                    <LiquidationProvider>
                      <SafetyProvider>
                        <LendingProvider>
                          <CDPProvider>
                        <BridgeProvider>
                              <TooltipProvider>
                              <Toaster />
                            <BrowserRouter>
                              <UsdstBalanceBox />
                              <Routes>
                                <Route path="/" element={<Index />} />
                                <Route path="/claim" element={<Claim />} />
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
                                      path="/dashboard/advanced"
                                  element={
                                    <ProtectedRoute>
                                          <Advanced />
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
                                      path="/bridge-transactions"
                                  element={
                                    <ProtectedRoute>
                                        <BridgeTransactionsPage />
                                    </ProtectedRoute>
                                  }
                                />

                                <Route
                                  path="/dashboard/stats"
                                  element={
                                    <ProtectedRoute>
                                        <StratoStats />
                                        </ProtectedRoute>
                                      }
                                    />

                                    <Route
                                      path="/dashboard/withdrawals"
                                      element={
                                        <ProtectedRoute>
                                          <WithdrawalsPage />
                                        </ProtectedRoute>
                                      }
                                    />

                                <Route
                                  path="/dashboard/rewards"
                                  element={
                                    <ProtectedRoute>
                                      <Rewards />
                                    </ProtectedRoute>
                                  }
                                />

                                <Route
                                  path="/dashboard/refer"
                                  element={
                                    <ProtectedRoute>
                                      <ReferFriend />
                                    </ProtectedRoute>
                                  }
                                />

                                <Route
                                  path="/dashboard/referrals"
                                  element={
                                    <ProtectedRoute>
                                      <ReferralsManagement />
                                    </ProtectedRoute>
                                  }
                                />

                                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                                <Route path="*" element={<NotFound />} />
                              </Routes>
                            </BrowserRouter>
                          </TooltipProvider>
                        </BridgeProvider>
                        </CDPProvider>
                        </LendingProvider>
                      </SafetyProvider>
                    </LiquidationProvider>
                  </TokenProvider>
                </OracleProvider>
              </SwapProvider>
          </UserTokensProvider>
        </UserProvider>
      </RainbowKitProvider>
      </WagmiProvider>
      </ThemeProvider>
    </NetworkProvider>
    </QueryClientProvider>
  );
};

export default App;

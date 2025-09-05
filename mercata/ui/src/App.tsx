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
import { Suspense, lazy, useState, useEffect } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import { coinbaseWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import { LendingProvider } from "./context/LendingContext";
import { TokenProvider } from "./context/TokenContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import { getConfig } from "./lib/config";

// Lazy load all pages
const Index = lazy(() => import("./pages/Index"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SwapAsset = lazy(() => import("./pages/SwapAsset"));
const Transfer = lazy(() => import("./pages/Transfer"));
const DepositsPage = lazy(() => import("./pages/DepositsPage"));
const AssetDetail = lazy(() => import("./pages/AssetDetail"));
const Pools = lazy(() => import("./pages/Pools"));
const ActivityFeed = lazy(() => import("./pages/ActivityFeed"));
const NotFound = lazy(() => import("./pages/NotFound"));
const BridgeTransactionsPage = lazy(() => import("./pages/BridgeTransactionsPage"));
const Admin = lazy(() => import("./pages/Admin"));
const Borrow = lazy(() => import("./pages/Borrow"));

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
                    <LiquidationProvider>
                      <BridgeProvider>
                        <TooltipProvider>
                          <Toaster />
                          <BrowserRouter>
                            <UsdstBalanceBox />
                            <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-32 w-32 border-b-2 border-strato-blue"></div></div>}>
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
                            </Suspense>
                          </BrowserRouter>
                        </TooltipProvider>
                      </BridgeProvider>
                    </LiquidationProvider>
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


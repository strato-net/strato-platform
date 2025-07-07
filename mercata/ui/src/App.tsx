import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
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
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Transfer from "./pages/Transfer";
import Assets from "./pages/Assets";
import AssetDetail from "./pages/AssetDetail";
import Borrow from "./pages/Borrow";
import Pools from "./pages/Pools";
import NotFound from "./pages/NotFound";

// Import dashboard components
import BridgePage from "./pages/BridgePage";
import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import { LendingProvider } from "./context/LendingContext";
import { TokenProvider } from "./context/TokenContext";
import { OnRampProvider } from "./context/OnRampContext";
import { TransactionProvider } from "@/context/TransactionContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import BorrowNew from "./pages/BorrowNew";

const queryClient = new QueryClient();

const projectId = "YOUR_PROJECT_ID"; //project_id required for v2wallet connect
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
      wallets: [metaMaskWallet],
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <WagmiProvider config={config}>
      <RainbowKitProvider>
        <UserProvider>
          <UserTokensProvider>
            <LendingProvider>
              <SwapProvider>
                <TokenProvider>
                  <OnRampProvider>
                    <LiquidationProvider>
                      <TransactionProvider>
                        <BridgeProvider>
                          <TooltipProvider>
                            <Toaster />
                            {/* <Sonner /> */}
                            <BrowserRouter>
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
                                      <Assets />
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
                                      <BorrowNew />
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
                                  path="/dashboard/bridge"
                                  element={<BridgePage />}
                                />
                                <Route
                                  path="/dashboard/bridge-transactions"
                                  element={<BridgeTransactionsPage />}
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
              </SwapProvider>
            </LendingProvider>
          </UserTokensProvider>
        </UserProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  </QueryClientProvider>
);

export default App;


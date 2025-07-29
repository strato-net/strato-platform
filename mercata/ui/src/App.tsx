import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import UsdstBalanceBox from "@/components/layouts/UsdstBalanceBox";
import { QueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { mainnet, polygon, sepolia } from "wagmi/chains";
import {
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import { lazy, Suspense } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import AdminRoute from "./components/AdminRoute";
import AppProviders from "./context/AppProviders";

// Lazy load all pages for code splitting
const Index = lazy(() => import("./pages/Index"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const SwapAsset = lazy(() => import("./pages/SwapAsset"));
const Transfer = lazy(() => import("./pages/Transfer"));
const DepositsPage = lazy(() => import("./pages/DepositsPage"));
const AssetDetail = lazy(() => import("./pages/AssetDetail"));
const Pools = lazy(() => import("./pages/Pools"));
const ActivityFeed = lazy(() => import("./pages/ActivityFeed"));
const NotFound = lazy(() => import("./pages/NotFound"));
const BridgePage = lazy(() => import("./pages/BridgePage"));
const BridgeTransactionsPage = lazy(() => import("./pages/BridgeTransactionsPage"));
const Admin = lazy(() => import("./pages/Admin"));
const Borrow = lazy(() => import("./pages/Borrow"));

// Loading component for Suspense fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

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
  <AppProviders queryClient={queryClient} wagmiConfig={config}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter>
        <UsdstBalanceBox />
        <Suspense fallback={<PageLoader />}>
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
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </AppProviders>
);

export default App;


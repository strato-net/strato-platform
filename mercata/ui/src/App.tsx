import { Toaster } from "@/components/ui/toaster";
import { Loader2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import UsdstBalanceBox from "@/components/layouts/UsdstBalanceBox";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Transport, WagmiProvider } from "wagmi";
import { mainnet, polygon, sepolia, base, baseSepolia, linea, lineaSepolia } from "wagmi/chains";
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
import SyncingPage from "./pages/SyncingPage";
import StratoStats from "./pages/StratoStats";
import Rewards from "./pages/Rewards";
import Claim from "./pages/Claim";
import CommunityRewardsOnePager from "./pages/CommunityRewardsOnePager";
import PriceTracking from "./pages/PriceTracking";
import Vault from "./pages/Vault";
import Earn from "./pages/Earn";
import EarnSave from "./pages/EarnSave";
import EarnVault from "./pages/EarnVault";
import EarnLending from "./pages/EarnLending";
import EarnPools from "./pages/EarnPools";
import EarnYieldVault from "./pages/EarnYieldVault";
import OnrampPage from "./pages/OnrampPage";

// Import dashboard components

import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import MetalTransactionsPage from "./pages/MetalTransactionsPage";
import WithdrawalsPage from "./pages/WithdrawalsPage";
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import GuestAccessibleRoute from "./components/GuestAccessibleRoute";
import {
  coinbaseWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { stratoWallet } from "@/lib/stratoWallet";
import { initStratoChain, getStratoChain } from "@/lib/stratoChain";
import AdminRoute from "./components/AdminRoute";
import { TokenProvider } from "./context/TokenContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { EarnProvider } from "@/context/EarnContext";
import { LiquidationProvider } from "./context/LiquidationContext";
import { SafetyProvider } from "./context/SafetyContext";
import { LendingProvider } from "@/context/LendingContext";
import { CDPProvider } from "@/context/CDPContext";
import { SwapProvider } from "@/context/SwapContext";
import { NetworkProvider } from "@/context/NetworkContext";
import { VaultProvider } from "@/context/VaultContext";
import { SaveUsdstProvider } from "@/context/SaveUsdstContext";
import { YieldVaultProvider } from "@/context/YieldVaultContext";
import Borrow from "./pages/Borrow";
import { getConfig } from "./lib/config";
import { useState, useEffect, type ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { csrfOnRequest, initializeCsrfToken } from "./lib/csrf";
import { captureAttribution } from "./lib/attribution";
import { getNodeHealth, shouldShowNodeHealth, type NodeHealth } from "./lib/nodeHealth";
import { useUser } from "@/context/UserContext";


const queryClient = new QueryClient();
const proxiedChainIds = new Set([mainnet.id, sepolia.id, base.id, baseSepolia.id, linea.id, lineaSepolia.id]);
const baseChains = [mainnet, polygon, sepolia, base, baseSepolia, linea, lineaSepolia] as const;

const AuthGate = ({ children }: { children: ReactNode }) => {
  const { loading } = useUser();
  if (loading) return null;
  return <>{children}</>;
};

const App = () => {
  const [projectId, setProjectId] = useState("PROJECT_ID_UNSET");
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [creditCardTopUpAddress, setCreditCardTopUpAddress] = useState<string | null>(null);
  const [contactEnabled, setContactEnabled] = useState(false);
  const [wagmiConfig, setWagmiConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const [nodeHealth, setNodeHealth] = useState<NodeHealth | null>(null);

  // Initialize CSRF token on app startup
  useEffect(() => {
    initializeCsrfToken();
  }, []);

  // Capture inbound UTM params before any auth redirect (Keycloak strips query params).
  useEffect(() => {
    captureAttribution();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    const fetchConfig = async () => {
      try {
        const [configData] = await Promise.all([getConfig(), initStratoChain()]);
        if (!cancelled) {
          setProjectId(configData.projectId ?? "PROJECT_ID_UNSET");
          if (configData.networkId) setNetworkId(String(configData.networkId));
          if (configData.creditCardTopUpAddress) setCreditCardTopUpAddress(String(configData.creditCardTopUpAddress));
          if (configData.contactEnabled) setContactEnabled(true);
          setConfigError(false);
        }
      } catch (error) {
        console.error("Failed to fetch config:", error);
        if (!cancelled) {
          setConfigError(true);
          retryTimeout = setTimeout(fetchConfig, 15000);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    fetchConfig();

    return () => {
      cancelled = true;
      clearTimeout(retryTimeout);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshNodeHealth = async () => {
      const health = await getNodeHealth();
      if (!cancelled) {
        setNodeHealth(shouldShowNodeHealth(health) ? health : null);
      }
    };

    refreshNodeHealth();
    const interval = setInterval(refreshNodeHealth, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      const appName = "STRATO";
      const stratoChain = getStratoChain();
      const chains = stratoChain ? [...baseChains, stratoChain] : baseChains;
      const transports: Record<number, Transport> = Object.fromEntries(
        chains.map((chain) => [
          chain.id,
          chain === stratoChain
            ? http(`/rpc`)
            : proxiedChainIds.has(chain.id)
              ? http(`/api/rpc/${chain.id}`, { fetchOptions: { credentials: "include" }, onFetchRequest: csrfOnRequest })
              : http(),
        ])
      );

      const connectors = connectorsForWallets(
        [
          ...(stratoChain
            ? [{ groupName: "STRATO", wallets: [stratoWallet] }]
            : []),
          {
            groupName: "External",
            wallets: [metaMaskWallet, coinbaseWallet, walletConnectWallet],
          },
        ],
        { projectId, appName }
      );

      const config = createConfig({
        connectors,
        chains: chains as unknown as readonly [typeof mainnet, ...(typeof baseChains)],
        transports,
      });

      setWagmiConfig(config);
    }
  }, [projectId, loading]);

  const networkIdStr = networkId ?? undefined;
  const creditCardTopUpAddressStr = creditCardTopUpAddress ?? undefined;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (configError) {
    return <SyncingPage nodeHealth={nodeHealth} />;
  }

  if (nodeHealth) {
    return <SyncingPage nodeHealth={nodeHealth} />;
  }

  if (!wagmiConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <NetworkProvider initialNetworkId={networkIdStr} initialCreditCardTopUpAddress={creditCardTopUpAddressStr} initialContactEnabled={contactEnabled}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <WagmiProvider config={wagmiConfig}>
            <RainbowKitProvider>
              <UserProvider>
                <AuthGate>
                <UserTokensProvider>
                  <SwapProvider>
                    <OracleProvider>
                      <TokenProvider>
                        <LiquidationProvider>
                          <SafetyProvider>
                            <LendingProvider>
                              <CDPProvider>
                                <BridgeProvider>
                                  <EarnProvider>
                                    <VaultProvider>
                                      <SaveUsdstProvider>
                                        <YieldVaultProvider>
                                          <TooltipProvider>
                                            <Toaster />
                                            <BrowserRouter>
                                              <UsdstBalanceBox />
                                              <Routes>
                                                <Route path="/" element={<Index />} />
                                                <Route path="/claim" element={<Claim />} />
                                                <Route
                                                  path="/communityrewards"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <CommunityRewardsOnePager />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Dashboard />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/swap"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <SwapAsset />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/deposits"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <DepositsPage />
                                                    </GuestAccessibleRoute>
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
                                                    <GuestAccessibleRoute>
                                                      <Borrow />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/advanced"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Advanced />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/vault"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Vault />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn-vault"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <EarnVault />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Earn />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn-save"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <EarnSave />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn-lending"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <EarnLending />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn-yield-vault"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <EarnYieldVault />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/earn-pools"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <EarnPools />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/activity"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <ActivityFeed />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
                                                <Route
                                                  path="/dashboard/transfer"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Transfer />
                                                    </GuestAccessibleRoute>
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
                                                  path="/metal-transactions"
                                                  element={
                                                    <ProtectedRoute>
                                                      <MetalTransactionsPage />
                                                    </ProtectedRoute>
                                                  }
                                                />
      
                                                <Route
                                                  path="/dashboard/stats"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <StratoStats />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
      
                                                <Route
                                                  path="/dashboard/withdrawals"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <WithdrawalsPage />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
      
                                                <Route
                                                  path="/dashboard/rewards"
                                                  element={
                                                    <GuestAccessibleRoute>
                                                      <Rewards />
                                                    </GuestAccessibleRoute>
                                                  }
                                                />
      
                                                <Route
                                                  path="/dashboard/trading-desk"
                                                  element={
                                                    <ProtectedRoute>
                                                      <PriceTracking />
                                                    </ProtectedRoute>
                                                  }
                                                />
      
                                                <Route
                                                  path="/dashboard/onramp"
                                                  element={
                                                    <ProtectedRoute>
                                                      <OnrampPage />
                                                    </ProtectedRoute>
                                                  }
                                                />
      
                                                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                                                <Route path="*" element={<NotFound />} />
                                              </Routes>
                                            </BrowserRouter>
                                          </TooltipProvider>
                                        </YieldVaultProvider>
                                      </SaveUsdstProvider>
                                    </VaultProvider>
                                  </EarnProvider>
                                </BridgeProvider>
                              </CDPProvider>
                            </LendingProvider>
                          </SafetyProvider>
                        </LiquidationProvider>
                      </TokenProvider>
                    </OracleProvider>
                  </SwapProvider>
                </UserTokensProvider>
                </AuthGate>
              </UserProvider>
            </RainbowKitProvider>
          </WagmiProvider>
        </ThemeProvider>
      </NetworkProvider>
    </QueryClientProvider>
  );
};

export default App;

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { UserProvider } from "@/context/UserContext";
import { buildWagmiConfig } from "@/lib/wagmi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import DashboardPage from "@/pages/DashboardPage";
import AccountsPage from "@/pages/AccountsPage";
import ContractsPage from "@/pages/ContractsPage";
import ExplorerPage from "@/pages/ExplorerPage";
import BlockDetailPage from "@/pages/BlockDetailPage";
import TransactionDetailPage from "@/pages/TransactionDetailPage";
import SearchPage from "@/pages/SearchPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();
const wagmiConfig = buildWagmiConfig();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
        <WagmiProvider config={wagmiConfig}>
          <RainbowKitProvider>
            <UserProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter basename="/smd">
                  <Routes>
                    <Route element={<DashboardLayout />}>
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/accounts" element={<AccountsPage />} />
                      <Route path="/contracts" element={<ContractsPage />} />
                      <Route path="/explorer" element={<ExplorerPage />} />
                      <Route path="/explorer/blocks/:number" element={<BlockDetailPage />} />
                      <Route path="/explorer/transactions/:hash" element={<TransactionDetailPage />} />
                      <Route path="/explorer/search" element={<SearchPage />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </BrowserRouter>
              </TooltipProvider>
            </UserProvider>
          </RainbowKitProvider>
        </WagmiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

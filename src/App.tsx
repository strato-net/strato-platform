
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import WalletCreated from "./pages/WalletCreated";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Transfer from "./pages/Transfer";
import Assets from "./pages/Assets";
import AssetDetail from "./pages/AssetDetail";
import Borrow from "./pages/Borrow";
import NotFound from "./pages/NotFound";
import { UserProvider } from "./context/UserContext";
import { UserTokensProvider } from "./context/UserTokensContext";
import { DepositableTokenProvider } from "./context/DepositableTokensContext";
import { SwapProvider } from "./context/SwapContext";
import { LoansProvider } from "./context/LoansContext";
import { LendingProvider } from "./context/LendingContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <UserProvider>
      <UserTokensProvider>
          <LendingProvider>
            <SwapProvider>
                <TooltipProvider>
                  <Toaster />
                  {/* <Sonner /> */}
                  <BrowserRouter>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/login" element={<Login />} />
                      <Route path="/register" element={<Register />} />
                      <Route path="/wallet-created" element={<WalletCreated />} />
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/dashboard/swap" element={<SwapAsset />} />
                      <Route path="/dashboard/assets" element={<Assets />} />
                      <Route path="/dashboard/assets/:id" element={<AssetDetail />} />
                      <Route path="/dashboard/borrow" element={<Borrow />} />
                      <Route path="/dashboard/transfer" element={<Transfer />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </BrowserRouter>
                </TooltipProvider>
            </SwapProvider>
          </LendingProvider>
      </UserTokensProvider>
    </UserProvider>
  </QueryClientProvider>
);

export default App;

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Transfer from "./pages/Transfer";
import Assets from "./pages/Assets";
import AssetDetail from "./pages/AssetDetail";
import Borrow from "./pages/Borrow";
import Pools from "./pages/Pools";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";
import { UserProvider } from "./context/UserContext";
import { UserTokensProvider } from "./context/UserTokensContext";
import { SwapProvider } from "./context/SwapContext";
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
                      <Route path="/dashboard" element={
                        <ProtectedRoute>
                          <Dashboard />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/swap" element={
                        <ProtectedRoute>
                          <SwapAsset />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/assets" element={
                        <ProtectedRoute>
                          <Assets />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/assets/:id" element={
                        <ProtectedRoute>
                          <AssetDetail />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/borrow" element={
                        <ProtectedRoute>
                          <Borrow />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/pools" element={
                        <ProtectedRoute>
                          <Pools />
                        </ProtectedRoute>
                      } />
                      <Route path="/dashboard/transfer" element={
                        <ProtectedRoute>
                          <Transfer />
                        </ProtectedRoute>
                      } />
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

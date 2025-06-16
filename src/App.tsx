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
import Admin from "./pages/Admin";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import { UserProvider } from "./context/UserContext";
import { UserTokensProvider } from "./context/UserTokensContext";
import { SwapProvider } from "./context/SwapContext";
import { LendingProvider } from "./context/LendingContext";
import { TokenProvider } from "./context/TokenContext";
import { OnRampProvider } from "./context/OnRampContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <UserProvider>
      <UserTokensProvider>
        <LendingProvider>
          <SwapProvider>
            <TokenProvider>
              <OnRampProvider>
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
                        path="/dashboard/assets"
                        element={
                          <ProtectedRoute>
                            <Assets />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/dashboard/assets/:id"
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
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </BrowserRouter>
                </TooltipProvider>
              </OnRampProvider>
            </TokenProvider>
          </SwapProvider>
        </LendingProvider>
      </UserTokensProvider>
    </UserProvider>
  </QueryClientProvider>
);

export default App;

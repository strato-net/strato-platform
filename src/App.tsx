import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
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
import Assets from "./pages/Assets";
import AssetDetail from "./pages/AssetDetail";
import Borrow from "./pages/Borrow";
import NotFound from "./pages/NotFound";
import DashboardLayout from "./components/layouts/DashboardLayout";

// Import dashboard components
import AssetsList from "./components/dashboard/AssetList";
import BridgePage from "./pages/BridgePage";
import BridgeTransactionsPage from "./pages/BridgeTransactionsPage";
import DepositPage from "./pages/DepositPage";
import DepositOptionsPage from "./pages/DepositOptionsPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/wallet-created" element={<WalletCreated />} />
          <Route path="/onboarding" element={<Onboarding />} />
          
          {/* Dashboard Routes */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/swap" element={<SwapAsset />} />
            <Route path="/dashboard/assets" element={<Assets />} />
            <Route path="/dashboard/assets/:id" element={<AssetDetail />} />
            <Route path="/dashboard/borrow" element={<Borrow />} />
            <Route path="/dashboard/assets-list" element={<AssetsList />} />
            <Route path="/dashboard/bridge" element={<BridgePage />} />
            <Route path="/dashboard/bridge-transactions" element={<BridgeTransactionsPage />} />
            <Route path="/dashboard/deposit" element={<DepositPage />} />
            <Route path="/dashboard/deposit-options" element={<DepositOptionsPage />} />
          </Route>
          
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

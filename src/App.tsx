
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ConfirmEmail from "./pages/ConfirmEmail";
import WalletCreated from "./pages/WalletCreated";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import SwapAsset from "./pages/SwapAsset";
import Assets from "./pages/Assets";
import AssetDetail from "./pages/AssetDetail";
import Borrow from "./pages/Borrow";
import Pools from "./pages/Pools";
import NotFound from "./pages/NotFound";

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
          <Route path="/confirm-email" element={<ConfirmEmail />} />
          <Route path="/wallet-created" element={<WalletCreated />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dashboard/swap" element={<SwapAsset />} />
          <Route path="/dashboard/assets" element={<Assets />} />
          <Route path="/dashboard/assets/:id" element={<AssetDetail />} />
          <Route path="/dashboard/borrow" element={<Borrow />} />
          <Route path="/dashboard/pools" element={<Pools />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

import { useEffect } from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import BuyMetalsWidget from "@/components/buy-metals/BuyMetalsWidget";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

const BuyMetals = () => {
  const { isLoggedIn } = useUser();

  useEffect(() => {
    document.title = "Buy Metals | STRATO";
  }, []);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Buy Metals" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to buy gold and silver with stablecoins" />
          )}
          <div className="max-w-2xl mx-auto space-y-4 md:space-y-6">
            <div className="bg-card shadow-sm rounded-xl p-4 md:p-6 border border-border">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h2 className="text-base md:text-xl font-semibold">Buy precious metals</h2>
              </div>
              <BuyMetalsWidget guestMode={!isLoggedIn} />
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default BuyMetals;

import React from "react";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import SwapWidget from "@/components/swap/SwapWidget";

const SwapAsset = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
        <DashboardHeader title="Swap Assets" />
        <main className="p-6">
          <div className="max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-6">Exchange your digital assets</h2>
            <SwapWidget />
          </div>
        </main>
      </div>
    </div>
  );
};

export default SwapAsset;
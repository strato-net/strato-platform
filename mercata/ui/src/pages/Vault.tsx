import { useState, useEffect } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileSidebar from "@/components/dashboard/MobileSidebar";
import VaultOverview from "@/components/vault/VaultOverview";
import VaultTransactions from "@/components/vault/VaultTransactions";
import VaultUserPosition from "@/components/vault/VaultUserPosition";
import VaultDepositModal from "@/components/vault/VaultDepositModal";
import VaultWithdrawModal from "@/components/vault/VaultWithdrawModal";
import { useVaultContext } from "@/context/VaultContext";

const Vault = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);

  const { refreshVault } = useVaultContext();

  useEffect(() => {
    document.title = "STRATO Vault | STRATO";
  }, []);

  const handleDepositSuccess = () => {
    refreshVault(false);
  };

  const handleWithdrawSuccess = () => {
    refreshVault(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader
          title="STRATO Vault"
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-6 space-y-8">
          {/* Global Metrics */}
          <VaultOverview />

          {/* User Position & Actions */}
          <VaultUserPosition
            onDeposit={() => setIsDepositModalOpen(true)}
            onWithdraw={() => setIsWithdrawModalOpen(true)}
          />

          {/* Recent Transactions */}
          <VaultTransactions />
        </main>
      </div>

      {/* Modals */}
      <VaultDepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        onSuccess={handleDepositSuccess}
      />

      <VaultWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={() => setIsWithdrawModalOpen(false)}
        onSuccess={handleWithdrawSuccess}
      />
    </div>
  );
};

export default Vault;

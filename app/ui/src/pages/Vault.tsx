import { useState } from "react";
import VaultOverview from "@/components/vault/VaultOverview";
import VaultTransactions from "@/components/vault/VaultTransactions";
import VaultUserActivity from "@/components/vault/VaultUserActivity";
import VaultUserPosition from "@/components/vault/VaultUserPosition";
import VaultWithdrawModal, { WithdrawMode } from "@/components/vault/VaultWithdrawModal";
import { useVaultContext } from "@/context/VaultContext";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

const Vault = () => {
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawMode, setWithdrawMode] = useState<WithdrawMode>("usd");

  const openWithdraw = (mode: WithdrawMode) => {
    setWithdrawMode(mode);
    setIsWithdrawModalOpen(true);
  };

  const { refreshVault } = useVaultContext();
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;

  const handleWithdrawSuccess = () => {
    refreshVault(false);
  };

  return (
    <>
      {guestMode && (
        <GuestSignInBanner message="Sign in to withdraw from the vault" />
      )}

      <div className="space-y-8">
        <VaultOverview />

        <VaultUserPosition
          onWithdraw={() => openWithdraw("usd")}
          onWithdrawAll={() => openWithdraw("all")}
          guestMode={guestMode}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <VaultTransactions />
          {!guestMode && <VaultUserActivity />}
        </div>
      </div>

      {!guestMode && (
        <VaultWithdrawModal
          isOpen={isWithdrawModalOpen}
          onClose={() => setIsWithdrawModalOpen(false)}
          onSuccess={handleWithdrawSuccess}
          defaultMode={withdrawMode}
        />
      )}
    </>
  );
};

export default Vault;

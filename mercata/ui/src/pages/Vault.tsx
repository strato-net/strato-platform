import { useState } from "react";
import VaultOverview from "@/components/vault/VaultOverview";
import VaultTransactions from "@/components/vault/VaultTransactions";
import VaultUserActivity from "@/components/vault/VaultUserActivity";
import VaultUserPosition from "@/components/vault/VaultUserPosition";
import VaultDepositModal from "@/components/vault/VaultDepositModal";
import VaultWithdrawModal from "@/components/vault/VaultWithdrawModal";
import { useVaultContext } from "@/context/VaultContext";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";

const Vault = () => {
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);

  const { refreshVault } = useVaultContext();
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;

  const handleDepositSuccess = () => {
    refreshVault(false);
  };

  const handleWithdrawSuccess = () => {
    refreshVault(false);
  };

  return (
    <>
      {guestMode && (
        <GuestSignInBanner message="Sign in to deposit or withdraw from the vault" />
      )}

      <div className="space-y-8">
        <VaultOverview />

        <VaultUserPosition
          onDeposit={() => setIsDepositModalOpen(true)}
          onWithdraw={() => setIsWithdrawModalOpen(true)}
          guestMode={guestMode}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <VaultTransactions />
          {!guestMode && <VaultUserActivity />}
        </div>
      </div>

      {!guestMode && (
        <>
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
        </>
      )}
    </>
  );
};

export default Vault;

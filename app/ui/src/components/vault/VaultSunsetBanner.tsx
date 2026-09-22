import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useVaultContext } from "@/context/VaultContext";
import { useUser } from "@/context/UserContext";
import { VAULT_WITHDRAWAL_DEADLINE } from "@/lib/constants";

const VAULT_PATH = "/dashboard/advanced?tab=vault";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatDeadline = (date: Date): string =>
  date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const daysUntil = (date: Date): number => Math.ceil((date.getTime() - Date.now()) / MS_PER_DAY);

interface VaultSunsetBannerProps {
  className?: string;
  /** Button label. Defaults to "Withdraw now". */
  actionLabel?: string;
  /** Called when the button is clicked. Defaults to navigating to the vault tab. */
  onAction?: () => void;
}

/**
 * Deprecation notice for the Diversified Vault. Renders only for signed-in
 * users who still hold vault shares, so holders see it wherever it is mounted
 * and everyone else sees nothing.
 */
const VaultSunsetBanner = ({ className = "", actionLabel = "Withdraw now", onAction }: VaultSunsetBannerProps) => {
  const { isLoggedIn } = useUser();
  const { vaultState } = useVaultContext();
  const navigate = useNavigate();

  const { userShares, loadingUser } = vaultState;

  if (!isLoggedIn || loadingUser) return null;
  if (BigInt(userShares || "0") === BigInt(0)) return null;

  const deadline = new Date(VAULT_WITHDRAWAL_DEADLINE);
  const days = daysUntil(deadline);
  const deadlineText = formatDeadline(deadline);

  const message =
    days > 0
      ? `The Diversified Vault is being retired. You have ${days} ${days === 1 ? "day" : "days"} left to withdraw your position, until ${deadlineText}. Deposits are already closed.`
      : `The Diversified Vault is being retired. The withdrawal window ended ${deadlineText}. Withdraw any remaining position now.`;

  const handleAction = () => {
    if (onAction) {
      onAction();
    } else {
      navigate(VAULT_PATH);
    }
  };

  return (
    <div className={`mb-4 md:mb-6 ${className}`}>
      <div className="bg-orange-500/10 dark:bg-orange-500/20 border border-orange-500/30 text-orange-800 dark:text-orange-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <p className="text-sm md:text-base font-medium flex-1 min-w-0">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAction}
          className="text-xs md:text-sm border-current hover:bg-current/10 self-start sm:self-auto flex-shrink-0"
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
};

export default VaultSunsetBanner;

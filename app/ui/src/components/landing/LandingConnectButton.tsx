import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import { requestWalletConnection } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface LandingConnectButtonProps {
  /** Dashboard route to open once a wallet is connected. */
  appPath: string;
  /** Label shown to a connected visitor, e.g. "Deposit USDST". */
  connectedLabel: string;
  className?: string;
}

/**
 * Primary CTA for the product landing pages.
 *
 * Logged out it opens the RainbowKit modal through the app's existing
 * `mercata:wallet-connect-request` event (see UserContext). Logged in it stops
 * saying "Connect Wallet" — which would be a dead button — and routes straight
 * to the product screen instead.
 */
const LandingConnectButton = ({
  appPath,
  connectedLabel,
  className,
}: LandingConnectButtonProps) => {
  const { isLoggedIn, loading } = useUser();
  const navigate = useNavigate();

  const handleClick = () => {
    if (loading) return;
    if (isLoggedIn) {
      navigate(appPath);
    } else {
      requestWalletConnection();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "group inline-flex w-full items-center justify-center gap-2 rounded-full bg-strato-lightblue px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:bg-strato-blue hover:shadow-md",
        loading && "cursor-not-allowed opacity-70",
        className,
      )}
    >
      {isLoggedIn ? connectedLabel : "Connect Wallet"}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
};

export default LandingConnectButton;

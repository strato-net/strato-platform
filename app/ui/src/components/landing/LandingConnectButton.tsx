import { ArrowRight } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { requestWalletConnection } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { capture } from "@/lib/analytics";

interface LandingConnectButtonProps {
  /** Dashboard route to open once a wallet is connected. */
  appPath: string;
  /** Label shown to a connected visitor, e.g. "Deposit USDST". */
  connectedLabel: string;
  className?: string;
  /** Landing page slug, for attributing the click in analytics. */
  slug?: string;
  /** Which CTA surface this instance is, e.g. "steps" or "cta_banner". */
  placement?: string;
}

const BASE_CLASSES =
  "group inline-flex w-full items-center justify-center gap-2 rounded-full bg-strato-lightblue px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:bg-strato-blue hover:shadow-md";

/**
 * Primary CTA for the product landing pages.
 *
 * Logged out it opens the RainbowKit modal through the app's existing
 * `mercata:wallet-connect-request` event (see UserContext). Logged in it stops
 * saying "Connect Wallet" — which would be a dead button — and opens the
 * product screen in a new tab so the landing page stays put.
 */
const LandingConnectButton = ({
  appPath,
  connectedLabel,
  className,
  slug,
  placement,
}: LandingConnectButtonProps) => {
  const { isLoggedIn, loading } = useUser();

  // Both branches are the same funnel step -- the CTA was clicked -- so both
  // report it, distinguished by is_logged_in.
  const captureClick = () =>
    capture("landing_cta_clicked", {
      slug,
      placement,
      app_path: appPath,
      is_logged_in: isLoggedIn,
    });

  if (isLoggedIn) {
    return (
      <a
        href={appPath}
        target="_blank"
        rel="noopener noreferrer"
        onClick={captureClick}
        className={cn(BASE_CLASSES, className)}
      >
        {connectedLabel}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (loading) return;
        captureClick();
        requestWalletConnection();
      }}
      disabled={loading}
      className={cn(BASE_CLASSES, loading && "cursor-not-allowed opacity-70", className)}
    >
      Connect Wallet
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
};

export default LandingConnectButton;

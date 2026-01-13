import { useEffect } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { RecipientClaim } from "@/components/refer/RecipientClaim";
import { useUser } from "@/context/UserContext";

const Claim = () => {
  const { userAddress, isLoggedIn } = useUser();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  useEffect(() => {
    document.title = "Claim Tokens | STRATO";
  }, []);

  // Store return URL in localStorage when user needs to sign up
  // This will be used after login to redirect back to this page with all query params
  useEffect(() => {
    if (!isLoggedIn && location.search) {
      // Store the full path with query params for redirect after login
      localStorage.setItem("claimReturnUrl", location.pathname + location.search);
    }
  }, [isLoggedIn, location]);

  // Check if we just logged in and need to redirect back
  useEffect(() => {
    if (isLoggedIn) {
      const returnUrl = localStorage.getItem("claimReturnUrl");
      if (returnUrl && returnUrl !== location.pathname + location.search) {
        // Clear the stored URL and redirect if we're not already on the right page
        localStorage.removeItem("claimReturnUrl");
        // Only redirect if the current URL doesn't match (to avoid infinite loops)
        if (returnUrl !== window.location.pathname + window.location.search) {
          window.location.href = returnUrl;
        }
      }
    }
  }, [isLoggedIn, location]);

  // TODO: These should be fetched from backend or configured via constants
  const escrowContractName = "Escrow";
  const escrowContractAddressNo0x = ""; // TODO: Add actual escrow contract address
  const redemptionServerUrl = "/api/refer/redeem"; // TODO: Update with actual redemption endpoint

  // Get user address without 0x prefix for RecipientClaim
  const currentRecipientAddressNo0x = userAddress
    ? userAddress.startsWith("0x")
      ? userAddress.slice(2).toLowerCase()
      : userAddress.toLowerCase()
    : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <RecipientClaim
            currentRecipientAddressNo0x={currentRecipientAddressNo0x}
            escrowContractAddressNo0x={escrowContractAddressNo0x}
            redemptionServerUrl={redemptionServerUrl}
            isLoggedIn={isLoggedIn}
          />
        </div>
      </div>
    </div>
  );
};

export default Claim;


import { useEffect, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";
import { redirectToStripeOnramp, StripeOnrampOptions } from "@/utils/stripeOnramp";
import { useToast } from "@/hooks/use-toast";

const StripePaymentPage = () => {
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.title = "Stripe Payment | STRATO";
    window.scrollTo(0, 0);
  }, []);

  const handleBuyCrypto = async () => {
    if (guestMode) {
      toast({
        title: "Sign in required",
        description: "Please sign in to buy crypto",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);

      // Configure Stripe onramp options
      const onrampOptions: StripeOnrampOptions = {
        source_currency: 'usd',
        destination_currencies: ['eth', 'usdc', 'btc'],
        destination_networks: ['ethereum', 'polygon', 'bitcoin'],
        destination_network: 'ethereum',
        destination_currency: 'eth',
      };

      // Redirect to Stripe-hosted onramp
      await redirectToStripeOnramp(onrampOptions);
    } catch (error) {
      console.error("Error redirecting to Stripe onramp:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open payment page. Please try again.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <DashboardHeader title="Stripe Payment" />

        <main className="p-4 md:p-6 pb-24 md:pb-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to buy crypto with Stripe" />
          )}

          <div className="max-w-2xl mx-auto flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <h2 className="text-2xl md:text-3xl font-bold text-center">
              Buy Crypto with Stripe
            </h2>
            
            <Button 
              className="w-full sm:w-auto"
              onClick={handleBuyCrypto}
              disabled={isLoading || guestMode}
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Buy Crypto
                </>
              )}
            </Button>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default StripePaymentPage;

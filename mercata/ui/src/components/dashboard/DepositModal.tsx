import { useState, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useOnRampContext } from "@/context/OnRampContext";
import { ethers } from "ethers";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CreditCard } from "lucide-react";
import { useOnRampPolling } from "@/hooks/useSmartPolling";

interface PaymentProvider {
  name: string;
  providerAddress: string;
}

interface ListingInfo {
  id: string;
  _name: string;
  _symbol: string;
  token: string;
  amount: string;
  providers: PaymentProvider[];
}

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// New DepositForm component
export const DepositForm = () => {
  const [amount, setAmount] = useState("1");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { get, buy } = useOnRampContext();
  const { userAddress } = useUser();

  const [selectedListing, setSelectedListing] = useState<ListingInfo | null>(null);
  const [availablePaymentProviders, setAvailablePaymentProviders] = useState<PaymentProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<PaymentProvider | null>(null);

  // Use the optimized polling hook
  const { startPolling, stopPolling, fetchData } = useOnRampPolling(
    get,
    (amount) => amount && parseFloat(amount) > 0
  );

  // Load initial data
  useEffect(() => {
    fetchData().then(result => {
      if (result) {
        setSelectedListing(result.listingInfo);
        setAvailablePaymentProviders(result.providers);
        setSelectedProvider(result.providers[0] || null);
      }
    });
  }, [fetchData]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAmount(value);
    
    // Smart polling based on amount
    value && parseFloat(value) > 0 ? startPolling() : stopPolling();
  };

  const handleDeposit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }
    if (!selectedListing || !selectedProvider) {
      toast({
        title: "No Listing or Provider",
        description: "Payment provider or listing not available.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const { url: stripeUrl } = await buy({
        token: selectedListing.token,
        amount: amount,
        paymentProviderAddress: selectedProvider.providerAddress,
      }, userAddress);
      
      if (stripeUrl) window.location.href = stripeUrl;
      else throw new Error("No checkout URL returned.");
    } catch (error) {
      console.error("Failed to lock on-ramp amount:", error);
    } finally {
      setLoading(false);
      stopPolling();
    }
  };

  const exceedsMax = selectedListing?.amount
    ? Number(amount) > Number(ethers.formatUnits(selectedListing.amount, 18)) || Number(amount) < 0.5
    : false;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="amount">Amount of USDST to purchase</Label>
        <Input
          id="amount"
          type="number"
          placeholder="e.g. 7"
          value={amount}
          onChange={handleAmountChange}
          className="pl-8"
        />
        {selectedListing?.amount && (
          <p className={`text-xs mt-1 ${exceedsMax ? "text-red-500" : "text-gray-500"}`}>
            Max available: {ethers.formatUnits(selectedListing.amount, 18)} USDST — Min: 0.5 USDST
          </p>
        )}
      </div>
      <div className="bg-gray-50 rounded-md">
        <h4 className="font-medium mb-2">Payment Method</h4>
        <div className="flex items-center gap-2 text-gray-600">
          <CreditCard className="h-5 w-5" />
          <div className="flex flex-col gap-2 ml-1">
            {availablePaymentProviders.map((provider) => (
              <label
                key={provider.providerAddress}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="paymentProvider"
                  value={provider.providerAddress}
                  checked={selectedProvider?.providerAddress === provider.providerAddress}
                  onChange={() => setSelectedProvider(provider)}
                  className="accent-blue-600"
                />
                <span className="text-gray-800 capitalize">
                  {provider.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="text-sm text-gray-500">
        <p>• Secure payment processing through Stripe</p>
        <p>• Instant USDST credit to your account</p>
        <p>• 1% processing fee applies</p>
      </div>
      <Button
        onClick={handleDeposit}
        disabled={loading || exceedsMax || !selectedProvider}
        className="w-full bg-strato-blue hover:bg-strato-blue/90 mt-6"
      >
        {loading ? "Processing..." : "Continue to Payment"}
      </Button>
    </div>
  );
};

// Update DepositModal to use DepositForm
const DepositModal = ({ isOpen, onClose }: DepositModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Buy USDST with Fiat
          </DialogTitle>
        </DialogHeader>
        <DepositForm />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DepositModal;

import { useState, useEffect } from "react";
import axios from "axios";
import { useUser } from "@/context/UserContext";
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

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DepositModal = ({ isOpen, onClose }: DepositModalProps) => {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const [selectedToken, setSelectedToken] = useState<any>(null);
  const [availablePaymentProviders, setAvailablePaymentProviders] = useState<
    { name: string; address: string }[]
  >([]);
  const [selectedProvider, setSelectedProvider] = useState<{
    name: string;
    address: string;
  } | null>(null);
  const { userAddress } = useUser();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await axios.get("/api/onramp");
        const listings = data?.listings;
        if (listings) {
          const arr = Object.values(listings).map((listing: any) => ({
            _name: listing.tokenName,
            _symbol: listing.tokenSymbol,
            address: listing.token,
            ...listing,
          }));
          const usdstToken = arr.find((token: any) => token._name === "USDST");
          if (usdstToken) {
            setSelectedToken(usdstToken);
            const providers = (usdstToken.paymentProviders || [])
              .filter(
                (p: any) =>
                  p &&
                  typeof p.providerAddress === "string" &&
                  typeof p.name === "string"
              )
              .map((p: any) => ({ name: p.name, address: p.providerAddress }));
            setAvailablePaymentProviders(providers);
            setSelectedProvider(providers[0] || null);
          }
        }
      } catch (error) {
        console.error("Error while getting listings:", error);
      }
    };

    if (isOpen) fetchData();
  }, [isOpen]);

  const handleDeposit = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (!selectedToken || !selectedProvider) {
      toast({
        title: "No Token or Provider",
        description: "Payment provider or token not available.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        listingId: selectedToken?.id,
        amount: ethers.parseUnits(amount, 18).toString(),
        paymentProviderAddress: selectedProvider?.address,
      };

      const headers = {
        address: userAddress,
      };

      const { data } = await axios.post<{ url: string }>(
        "/api/onramp/lock",
        payload,
        { headers }
      );
      const stripeUrl = data.url;

      if (stripeUrl) {
        window.location.href = stripeUrl;
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (error) {
      console.error("Failed to lock on-ramp amount:", error);
      toast({
        title: "Error",
        description: "Failed to process deposit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const exceedsMax = selectedToken?.amount
    ? Number(amount) > Number(ethers.formatUnits(selectedToken.amount, 18)) ||
      Number(amount) < 0.5
    : false;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Buy USDST with Fiat
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount of USDST to purchase</Label>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                placeholder="e.g. 7"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8"
              />
              {selectedToken?.amount && (
                <p
                  className={`text-xs mt-1 ${
                    exceedsMax ? "text-red-500" : "text-gray-500"
                  }`}
                >
                  Max available: {ethers.formatUnits(selectedToken.amount, 18)}{" "}
                  USDST — Min: 0.5 USDST
                </p>
              )}
            </div>
          </div>
          <div className="bg-gray-50 rounded-md">
            <h4 className="font-medium mb-2">Payment Method</h4>
            <div className="flex items-center gap-2 text-gray-600">
              <CreditCard className="h-5 w-5" />
              <div className="flex flex-col gap-2 ml-1">
                {availablePaymentProviders.map((provider) => (
                  <label
                    key={provider.address}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="paymentProvider"
                      value={provider.address}
                      checked={selectedProvider?.address === provider.address}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="mr-2">
            Cancel
          </Button>
          <Button
            onClick={handleDeposit}
            disabled={loading || !amount || exceedsMax}
            className="bg-strato-blue hover:bg-strato-blue/90"
          >
            {loading ? "Processing..." : "Continue to Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DepositModal;

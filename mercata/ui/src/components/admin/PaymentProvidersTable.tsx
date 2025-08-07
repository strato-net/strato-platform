import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PaymentProvider } from "@/interface";
import { Alert, AlertDescription } from "@/components/ui/alert";

const PaymentProvidersTable = () => {
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const fetchProviders = async () => {
    try {
      setRefreshing(true);
      // TODO: Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mockProviders: PaymentProvider[] = [
        {
          key: "stripe",
          value: {
            name: "Stripe",
            exists: true,
            endpoint: "https://api.stripe.com/v1/payment_intents",
            providerAddress: "0x1234567890123456789012345678901234567890"
          }
        },
        {
          key: "paypal",
          value: {
            name: "PayPal",
            exists: true,
            endpoint: "https://api.paypal.com/v2/checkout/orders",
            providerAddress: "0x0987654321098765432109876543210987654321"
          }
        },
        {
          key: "coinbase",
          value: {
            name: "Coinbase Commerce",
            exists: false,
            endpoint: "https://api.commerce.coinbase.com/charges",
            providerAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
          }
        }
      ];
      
      setProviders(mockProviders);
    } catch (error) {
      console.error("Error fetching providers:", error);
      toast({
        title: "Error",
        description: "Failed to fetch payment providers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDeleteProvider = async (providerKey: string) => {
    try {
      console.log("Deleting provider:", providerKey);
      toast({
        title: "Success",
        description: "Payment provider deleted successfully",
      });
      fetchProviders();
    } catch (error) {
      console.error("Error deleting provider:", error);
      toast({
        title: "Error",
        description: "Failed to delete payment provider",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (loading) {
    return (
      <Card className="border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <span>Payment Providers</span>
            <Loader2 className="h-4 w-4 animate-spin" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Payment Providers</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProviders}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80 overflow-y-auto border rounded-md">
          {providers.length === 0 ? (
            <div className="p-4">
              <Alert>
                <AlertDescription>
                  No payment providers configured yet. Add your first provider below.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {providers.map((provider) => (
                <div
                  key={provider.key}
                  className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-semibold">{provider.value.name}</h4>
                        <Badge variant={provider.value.exists ? "default" : "secondary"}>
                          {provider.value.exists ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>
                          <span className="font-medium">Address:</span>{" "}
                          <code className="bg-muted px-1 py-0.5 rounded text-xs">
                            {formatAddress(provider.value.providerAddress)}
                          </code>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium">Endpoint:</span>
                          <span className="truncate max-w-[200px]">
                            {provider.value.endpoint}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(provider.value.endpoint, '_blank')}
                            className="h-6 w-6 p-0"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProvider(provider.key)}
                      className="text-destructive hover:text-destructive ml-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PaymentProvidersTable;
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Trash2, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Listing } from "@/interface";
import { Alert, AlertDescription } from "@/components/ui/alert";

const OnRampListingsTable = () => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const fetchListings = async () => {
    try {
      setRefreshing(true);
      // TODO: Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mockListings: Listing[] = [
        {
          key: "listing-1",
          ListingInfo: {
            id: "1",
            token: "0xabcdef1234567890abcdef1234567890abcdef12",
            amount: "1000000000000000000000",
            seller: "0x1111111111111111111111111111111111111111",
            marginBps: "500",
            providers: [
              {
                name: "Stripe",
                exists: true,
                endpoint: "https://api.stripe.com/v1/payment_intents",
                providerAddress: "0x1234567890123456789012345678901234567890"
              }
            ],
            _name: "USD Coin",
            _symbol: "USDC",
            tokenOracleValue: "1.00"
          }
        },
        {
          key: "listing-2",
          ListingInfo: {
            id: "2",
            token: "0xfedcba0987654321fedcba0987654321fedcba09",
            amount: "500000000000000000000",
            seller: "0x2222222222222222222222222222222222222222",
            marginBps: "750",
            providers: [
              {
                name: "Stripe",
                exists: true,
                endpoint: "https://api.stripe.com/v1/payment_intents",
                providerAddress: "0x1234567890123456789012345678901234567890"
              },
              {
                name: "PayPal",
                exists: true,
                endpoint: "https://api.paypal.com/v2/checkout/orders",
                providerAddress: "0x0987654321098765432109876543210987654321"
              }
            ],
            _name: "Ethereum",
            _symbol: "ETH",
            tokenOracleValue: "2500.00"
          }
        },
        {
          key: "listing-3",
          ListingInfo: {
            id: "3",
            token: "0x9876543210987654321098765432109876543210",
            amount: "2000000000000000000000",
            seller: "0x3333333333333333333333333333333333333333",
            marginBps: "300",
            providers: [
              {
                name: "PayPal",
                exists: true,
                endpoint: "https://api.paypal.com/v2/checkout/orders",
                providerAddress: "0x0987654321098765432109876543210987654321"
              }
            ],
            _name: "Tether USD",
            _symbol: "USDT",
            tokenOracleValue: "0.999"
          }
        }
      ];
      
      setListings(mockListings);
    } catch (error) {
      console.error("Error fetching listings:", error);
      toast({
        title: "Error",
        description: "Failed to fetch onramp listings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDeleteListing = async (listingKey: string) => {
    try {
      console.log("Deleting listing:", listingKey);
      toast({
        title: "Success",
        description: "Listing deleted successfully",
      });
      fetchListings();
    } catch (error) {
      console.error("Error deleting listing:", error);
      toast({
        title: "Error",
        description: "Failed to delete listing",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchListings();
  }, []);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount: string, decimals: number = 18) => {
    const value = parseFloat(amount) / Math.pow(10, decimals);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatMargin = (marginBps: string) => {
    return `${(parseFloat(marginBps) / 100).toFixed(2)}%`;
  };

  if (loading) {
    return (
      <Card className="border-0">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <span>OnRamp Listings</span>
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
          <CardTitle>OnRamp Listings</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchListings}
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
          {listings.length === 0 ? (
            <div className="p-4">
              <Alert>
                <AlertDescription>
                  No asset listings available yet. Create your first listing below.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {listings.map((listing) => (
                <div
                  key={listing.key}
                  className="p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-semibold">
                          {listing.ListingInfo._symbol} - {listing.ListingInfo._name}
                        </h4>
                        {listing.ListingInfo.tokenOracleValue ? (
                          <Badge variant="outline">
                            ${listing.ListingInfo.tokenOracleValue}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">No Price</Badge>
                        )}
                      </div>
                      
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div className="flex items-center space-x-4">
                          <span>
                            <span className="font-medium">Amount:</span>{" "}
                            {formatAmount(listing.ListingInfo.amount)}
                          </span>
                          <span>
                            <span className="font-medium">Margin:</span>{" "}
                            {formatMargin(listing.ListingInfo.marginBps)}
                          </span>
                        </div>
                        
                        <div>
                          <span className="font-medium">Seller:</span>{" "}
                          <code className="bg-muted px-1 py-0.5 rounded text-xs">
                            {formatAddress(listing.ListingInfo.seller)}
                          </code>
                        </div>
                        
                        <div className="flex items-center space-x-1">
                          <span className="font-medium">Providers:</span>
                          <div className="flex flex-wrap gap-1">
                            {listing.ListingInfo.providers.map((provider, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {provider.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1 ml-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => console.log("View listing:", listing.key)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteListing(listing.key)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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

export default OnRampListingsTable;
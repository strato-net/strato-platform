import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOnRampContext } from "@/context/OnRampContext";
import { formatUnits } from "viem";

const OnRampListingsTable = () => {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { get } = useOnRampContext();

  const fetchListings = async () => {
    try {
      setRefreshing(true);
      const onRampData = await get();
      
      // Get the listings from the OnRamp data
      const listingsList = onRampData?.listings || [];
      
      // Filter out empty listings and format them
      const formattedListings = listingsList
        .filter(listing => listing.ListingInfo && listing.ListingInfo.id !== "0")
        .map(listing => ({
          key: listing.key || listing.ListingInfo.id,
          ListingInfo: listing.ListingInfo
        }));
      
      setListings(formattedListings);
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

  useEffect(() => {
    fetchListings();
  }, []);

  const formatAddress = (address: string) => {
    if (!address) return "N/A";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount: string, decimals: number = 18) => {
    if (!amount) return "0";
    try {
      const formatted = formatUnits(BigInt(amount), decimals);
      const num = parseFloat(formatted);
      return num.toLocaleString(undefined, { 
        minimumFractionDigits: 0,
        maximumFractionDigits: 4 
      });
    } catch {
      return "0";
    }
  };

  const formatMargin = (marginBps: string) => {
    if (!marginBps) return "0%";
    return `${(parseFloat(marginBps) / 100).toFixed(2)}%`;
  };

  const calculatePriceWithMargin = (oraclePrice: any, marginBps: string) => {
    if (!oraclePrice?.price) return null;
    const price = parseFloat(oraclePrice.price);
    const margin = parseFloat(marginBps) / 10000; // Convert basis points to decimal
    return (price * (1 + margin)).toFixed(2);
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
              {listings.map((listing) => {
                const info = listing.ListingInfo;
                const priceWithMargin = calculatePriceWithMargin(info.tokenOracleValue, info.marginBps);
                
                return (
                  <div
                    key={listing.key}
                    className="p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="font-semibold">
                            {info._symbol || "Unknown"} - {info._name || "Unknown Token"}
                          </h4>
                          <Badge variant="outline" className="text-xs">
                            ID: {info.id}
                          </Badge>
                        </div>
                        
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center space-x-4">
                            <span>
                              <span className="font-medium">Amount:</span>{" "}
                              {formatAmount(info.amount)} {info._symbol}
                            </span>
                            <span>
                              <span className="font-medium">Margin:</span>{" "}
                              <Badge variant="secondary" className="text-xs">
                                +{formatMargin(info.marginBps)}
                              </Badge>
                            </span>
                          </div>

                          {info.tokenOracleValue?.price && (
                            <div className="flex items-center space-x-4">
                              <span>
                                <span className="font-medium">Oracle Price:</span>{" "}
                                ${info.tokenOracleValue.price}
                              </span>
                              {priceWithMargin && (
                                <span>
                                  <span className="font-medium">Sale Price:</span>{" "}
                                  <Badge variant="default" className="text-xs">
                                    <DollarSign className="h-3 w-3" />
                                    {priceWithMargin}
                                  </Badge>
                                </span>
                              )}
                            </div>
                          )}
                          
                          <div>
                            <span className="font-medium">Seller:</span>{" "}
                            <code className="bg-muted px-1 py-0.5 rounded text-xs">
                              {formatAddress(info.seller)}
                            </code>
                          </div>

                          <div>
                            <span className="font-medium">Token Address:</span>{" "}
                            <code className="bg-muted px-1 py-0.5 rounded text-xs">
                              {formatAddress(info.token)}
                            </code>
                          </div>
                          
                          <div className="flex items-center space-x-1">
                            <span className="font-medium">Payment Providers:</span>
                            <div className="flex flex-wrap gap-1">
                              {info.providers && info.providers.length > 0 ? (
                                info.providers.map((provider: any, index: number) => (
                                  <Badge key={index} variant="secondary" className="text-xs">
                                    {provider.name || formatAddress(provider.providerAddress || provider)}
                                  </Badge>
                                ))
                              ) : (
                                <Badge variant="outline" className="text-xs">
                                  No providers
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default OnRampListingsTable;
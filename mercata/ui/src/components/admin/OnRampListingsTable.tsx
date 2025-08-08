import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOnRampContext } from "@/context/OnRampContext";
import { PaymentProviderValue } from "@/interface";
import { formatUnits } from "viem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const OnRampListingsTable = forwardRef<{refresh: () => void}>((props, ref) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listingToDelete, setListingToDelete] = useState<{ token: string; symbol: string } | null>(null);
  const { toast } = useToast();
  const { listings: contextListings, fetchOnRampData, cancelListing, loading: contextLoading } = useOnRampContext();

  // Filter and format listings from context
  const formattedListings = contextListings
    .filter(listing => listing.ListingInfo && listing.ListingInfo.id !== "0")
    .map(listing => ({
      key: listing.key || listing.ListingInfo.id,
      ListingInfo: listing.ListingInfo
    }));


  useEffect(() => {
    if (contextListings.length === 0 && !contextLoading) {
      fetchOnRampData();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Expose the refresh function to parent components
  useImperativeHandle(ref, () => ({
    refresh: fetchOnRampData
  }), [fetchOnRampData]);

  const handleDeleteClick = (token: string, symbol: string) => {
    setListingToDelete({ token, symbol: symbol || "Unknown" });
    setDeleteDialogOpen(true);
  };

  const handleCancelListing = async () => {
    if (!listingToDelete) return;
    
    try {
      const result = await cancelListing(listingToDelete.token);
      
      const successMessage = typeof result === 'string' 
        ? result 
        : result?.message || "Listing cancelled successfully";
      
      toast({
        title: "Success",
        description: successMessage,
      });
    } catch (error: unknown) {
      // Error is already handled by axios interceptor which shows a toast
      // The interceptor will display the specific error message from backend
      console.error("Error cancelling listing:", error);
    } finally {
      setDeleteDialogOpen(false);
      setListingToDelete(null);
    }
  };

  const formatAddress = (address: string) => {
    if (!address) return "N/A";
    // STRATO addresses don't have 0x prefix
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

  const calculatePriceWithMargin = (oraclePrice: { price: string } | null, marginBps: string) => {
    if (!oraclePrice?.price) return null;
    const price = parseFloat(oraclePrice.price);
    const margin = parseFloat(marginBps) / 10000; // Convert basis points to decimal
    return (price * (1 + margin)).toFixed(2);
  };

  if (contextLoading && contextListings.length === 0) {
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
    <>
    <Card className="border-0">
      <CardHeader>
        <CardTitle>OnRamp Listings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80 overflow-y-auto border rounded-md">
          {formattedListings.length === 0 ? (
            <div className="p-4">
              <Alert>
                <AlertDescription>
                  No asset listings available yet. Create your first listing below.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {formattedListings.map((listing) => {
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
                                info.providers.map((provider: PaymentProviderValue, index: number) => (
                                  <Badge key={index} variant="secondary" className="text-xs">
                                    {provider.name || formatAddress(provider.providerAddress || "Unknown")}
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
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(info.token, info._symbol)}
                        className="text-destructive hover:text-destructive ml-2"
                        title="Cancel listing"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>

    <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
      setDeleteDialogOpen(open);
      if (!open) {
        setListingToDelete(null);
      }
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Listing</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel the listing for <strong>{listingToDelete?.symbol || "this token"}</strong>?
            This action will return the remaining tokens to the seller and remove the listing from the OnRamp.
            <br /><br />
            <span className="text-sm font-semibold">Note: Only the seller can cancel their own listings.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => {
            setDeleteDialogOpen(false);
            setListingToDelete(null);
          }}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleCancelListing} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Cancel Listing
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
});

OnRampListingsTable.displayName = 'OnRampListingsTable';

export default OnRampListingsTable;
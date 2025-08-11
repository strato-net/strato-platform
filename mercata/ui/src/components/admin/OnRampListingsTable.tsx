import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, DollarSign, Trash2, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOnRampContext } from "@/context/OnRampContext";
import { PaymentProviderValue } from "@/interface";
import { formatUnits } from "viem";
import { safeParseUnits } from "@/utils/numberUtils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OnRampListingsTable = forwardRef<{refresh: () => void}>((props, ref) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listingToDelete, setListingToDelete] = useState<{ token: string; symbol: string } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [listingToEdit, setListingToEdit] = useState<{ ListingInfo: any } | null>(null);
  const [editForm, setEditForm] = useState({
    amount: "",
    marginBps: "",
    selectedProviders: [] as string[]
  });
  const [editLoading, setEditLoading] = useState(false);
  const { toast } = useToast();
  const { listings: contextListings, get, cancelListing, updateListing, loading: contextLoading, providers } = useOnRampContext();

  // Filter and format listings from context
  const formattedListings = contextListings
    .filter(listing => listing.ListingInfo && listing.ListingInfo.id !== "0")
    .map(listing => ({
      key: listing.key || listing.ListingInfo.id,
      ListingInfo: listing.ListingInfo
    }));


  useEffect(() => {
    if (contextListings.length === 0 && !contextLoading) {
      get();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Expose the refresh function to parent components
  useImperativeHandle(ref, () => ({
    refresh: get
  }), [get]);

  const handleDeleteClick = (token: string, symbol: string) => {
    setListingToDelete({ token, symbol: symbol || "Unknown" });
    setDeleteDialogOpen(true);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditClick = (listing: { ListingInfo: any }) => {
    const info = listing.ListingInfo;
    setListingToEdit(listing);
    
    // Convert amount from wei to human readable format
    const humanReadableAmount = formatAmount(info.amount);
    
    // Convert margin from basis points to percentage  
    const marginPercentage = (parseFloat(info.marginBps) / 100).toString();
    
    // Get selected provider addresses
    const providerAddresses = info.providers?.map((p: PaymentProviderValue) => p.providerAddress) || [];
    
    setEditForm({
      amount: humanReadableAmount,
      marginBps: marginPercentage,
      selectedProviders: providerAddresses
    });
    
    setEditDialogOpen(true);
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

  const handleUpdateListing = async () => {
    if (!listingToEdit || !editForm.amount || !editForm.marginBps || editForm.selectedProviders.length === 0) {
      toast({
        title: "Error",
        description: "Please fill in all required fields and select at least one payment provider.",
        variant: "destructive"
      });
      return;
    }
    
    setEditLoading(true);
    
    try {
      // Convert percentage to basis points (e.g., 5.00% -> 500 basis points)
      const marginBasisPoints = Math.round(parseFloat(editForm.marginBps) * 100).toString();
      
      // Convert human readable amount to wei (assuming 18 decimals)
      const weiAmount = safeParseUnits(editForm.amount, 18).toString();
      
      const result = await updateListing({
        token: listingToEdit.ListingInfo.token,
        amount: weiAmount,
        marginBps: marginBasisPoints,
        providerAddresses: editForm.selectedProviders
      });
      
      const successMessage = typeof result === 'string' 
        ? result 
        : result?.message || "Listing updated successfully";
      
      toast({
        title: "Success",
        description: successMessage,
      });
      
      setEditDialogOpen(false);
      setListingToEdit(null);
      setEditForm({
        amount: "",
        marginBps: "",
        selectedProviders: []
      });
      
    } catch (error: unknown) {
      console.error("Error updating listing:", error);
      toast({
        title: "Error",
        description: "Failed to update listing. Please try again.",
        variant: "destructive"
      });
    } finally {
      setEditLoading(false);
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
                      
                      <div className="flex items-center space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(listing)}
                          title="Edit listing"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(info.token, info._symbol)}
                          className="text-destructive hover:text-destructive"
                          title="Cancel listing"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

    {/* Edit Listing Dialog */}
    <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Listing</DialogTitle>
          <DialogDescription>
            Update the details for {listingToEdit?.ListingInfo?._symbol || "this"} listing
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Amount Field */}
          <div className="space-y-2">
            <Label htmlFor="edit-amount">Amount ({listingToEdit?.ListingInfo?._symbol})</Label>
            <Input
              id="edit-amount"
              type="number"
              step="0.0001"
              min="0"
              value={editForm.amount}
              onChange={(e) => setEditForm(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="Enter amount"
            />
          </div>

          {/* Margin Field */}
          <div className="space-y-2">
            <Label htmlFor="edit-margin">Margin (%)</Label>
            <Input
              id="edit-margin"
              type="number"
              step="0.01"
              min="0"
              value={editForm.marginBps}
              onChange={(e) => setEditForm(prev => ({ ...prev, marginBps: e.target.value }))}
              placeholder="Enter margin percentage (e.g. 5.00 for 5%)"
            />
          </div>

          {/* Payment Providers */}
          <div className="space-y-2">
            <Label>Payment Providers</Label>
            <div className="space-y-2 max-h-32 overflow-y-auto border rounded p-2">
              {providers.map((provider) => (
                <div key={provider.value.providerAddress} className="flex items-center space-x-2">
                  <Checkbox
                    id={`edit-provider-${provider.value.providerAddress}`}
                    checked={editForm.selectedProviders.includes(provider.value.providerAddress)}
                    onCheckedChange={(checked) => {
                      setEditForm(prev => ({
                        ...prev,
                        selectedProviders: checked
                          ? [...prev.selectedProviders, provider.value.providerAddress]
                          : prev.selectedProviders.filter(addr => addr !== provider.value.providerAddress)
                      }));
                    }}
                  />
                  <Label htmlFor={`edit-provider-${provider.value.providerAddress}`} className="text-sm">
                    {provider.value.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditDialogOpen(false)}
            disabled={editLoading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpdateListing}
            disabled={editLoading}
          >
            {editLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              "Update Listing"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
});

OnRampListingsTable.displayName = 'OnRampListingsTable';

export default OnRampListingsTable;
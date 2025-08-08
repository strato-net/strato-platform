import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useOnRampContext } from "@/context/OnRampContext";
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

const PaymentProvidersTable = forwardRef((props, ref) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<{ address: string; name: string } | null>(null);
  const { toast } = useToast();
  const { providers, loading, fetchOnRampData, removePaymentProvider } = useOnRampContext();
  const [refreshing, setRefreshing] = useState(false);

  // Format providers for display
  const formattedProviders = providers.map(provider => ({
    key: provider.key,
    value: provider.value || provider
  }));

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await fetchOnRampData();
    } catch (error: any) {
      console.error("Error refreshing providers:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteClick = (providerAddress: string, providerName: string) => {
    setProviderToDelete({ address: providerAddress, name: providerName || "Unknown Provider" });
    setDeleteDialogOpen(true);
  };

  const handleDeleteProvider = async () => {
    if (!providerToDelete) return;
    
    try {
      const result = await removePaymentProvider(providerToDelete.address);
      
      const successMessage = typeof result === 'string' 
        ? result 
        : result?.message || "Payment provider removed successfully";
      
      toast({
        title: "Success",
        description: successMessage,
      });
    } catch (error: any) {
      console.error("Error deleting provider:", error);
    } finally {
      setDeleteDialogOpen(false);
      setProviderToDelete(null);
    }
  };

  useEffect(() => {
    // Fetch data on mount if not already loaded
    if (providers.length === 0 && !loading) {
      fetchOnRampData();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  useImperativeHandle(ref, () => ({
    refresh: fetchOnRampData
  }), [fetchOnRampData]);

  const formatAddress = (address: string) => {
    if (!address) return "N/A";
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
    <>
      <Card className="border-0">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Payment Providers</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
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
            {formattedProviders.length === 0 ? (
              <div className="p-4">
                <Alert>
                  <AlertDescription>
                    No payment providers configured yet. Add your first provider below.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="space-y-2 p-2">
                {formattedProviders.map((provider) => {
                  if (!provider || !provider.value) {
                    return null;
                  }
                  
                  return (
                    <div
                      key={provider.key}
                      className="p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center space-x-2">
                            <h4 className="font-semibold">{provider.value.name || "Unknown Provider"}</h4>
                          </div>
                        
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div>
                            <span className="font-medium">Address:</span>{" "}
                            <code className="bg-muted px-1 py-0.5 rounded text-xs">
                              {formatAddress(provider.value.providerAddress || provider.key)}
                            </code>
                          </div>
                          <div>
                            <span className="font-medium">Endpoint:</span>{" "}
                            <span className="break-all">
                              {provider.value.endpoint || "N/A"}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(provider.key, provider.value?.name || "Unknown")}
                        className="text-destructive hover:text-destructive ml-2"
                        title="Remove provider"
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
          setProviderToDelete(null);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{providerToDelete?.name || "this provider"}</strong>?
              This action cannot be undone and will remove the provider from the OnRamp contract.
              <br /><br />
              <span className="text-sm font-semibold">Note: You must be an OnRamp admin to remove payment providers.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false);
              setProviderToDelete(null);
            }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProvider} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove Provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

PaymentProvidersTable.displayName = 'PaymentProvidersTable';

export default PaymentProvidersTable;
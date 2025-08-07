import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
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

const PaymentProvidersTable = () => {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<{ address: string; name: string } | null>(null);
  const { toast } = useToast();
  const { get, removePaymentProvider } = useOnRampContext();

  const fetchProviders = async () => {
    try {
      setRefreshing(true);
      const onRampData = await get();
      
      // Convert the paymentProviders object to an array
      const providersList = onRampData?.paymentProviders || [];
      const formattedProviders = providersList.map(provider => ({
        key: provider.key || provider.providerAddress,
        value: provider.value || provider
      }));
      
      setProviders(formattedProviders);
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

  const handleDeleteClick = (providerAddress: string, providerName: string) => {
    setProviderToDelete({ address: providerAddress, name: providerName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteProvider = async () => {
    if (!providerToDelete) return;
    
    try {
      const result = await removePaymentProvider(providerToDelete.address);
      toast({
        title: "Success",
        description: result.message || "Payment provider removed successfully",
      });
      fetchProviders();
    } catch (error: any) {
      console.error("Error deleting provider:", error);
      toast({
        title: "Error",
        description: error?.response?.data?.message || error?.message || "Failed to delete payment provider",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setProviderToDelete(null);
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
    <>
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
                    className="p-4 rounded-lg bg-card hover:bg-accent/50 transition-colors"
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
                              {formatAddress(provider.value.providerAddress || provider.key)}
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
                        onClick={() => handleDeleteClick(provider.key, provider.value.name)}
                        className="text-destructive hover:text-destructive ml-2"
                        title="Remove provider"
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{providerToDelete?.name}</strong>?
              This action cannot be undone and will remove the provider from the OnRamp contract.
              <br /><br />
              <span className="text-sm font-semibold">Note: You must be an OnRamp admin to remove payment providers.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setProviderToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProvider} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove Provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PaymentProvidersTable;
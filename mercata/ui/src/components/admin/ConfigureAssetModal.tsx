import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings, TrendingUp, Percent, Shield, AlertTriangle } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLendingContext } from '@/context/LendingContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ConfigureAssetFormValues {
  ltv: string;
  liquidationThreshold: string;
  liquidationBonus: string;
  interestRate: string;
  reserveFactor: string;
}

interface ConfigureAssetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: {
    address: string;
    symbol: string;
    name: string;
  } | null;
  currentConfig?: {
    ltv?: string;
    liquidationThreshold?: string;
    liquidationBonus?: string;
    interestRate?: string;
    reserveFactor?: string;
  };
  onSuccess?: () => Promise<void>;
}

const ConfigureAssetModal = ({ 
  open, 
  onOpenChange, 
  token, 
  currentConfig,
  onSuccess 
}: ConfigureAssetModalProps) => {
  const { toast } = useToast();
  const { configureAsset, loading } = useLendingContext();
  
  const form = useForm<ConfigureAssetFormValues>({
    defaultValues: {
      ltv: currentConfig?.ltv?.replace('%', '') || '75',
      liquidationThreshold: currentConfig?.liquidationThreshold?.replace('%', '') || '80',
      liquidationBonus: currentConfig?.liquidationBonus?.replace('%', '') || '105',
      interestRate: currentConfig?.interestRate?.replace('%', '') || '5',
      reserveFactor: currentConfig?.reserveFactor?.replace('%', '') || '10',
    },
  });

  const validateForm = (data: ConfigureAssetFormValues) => {
    const ltv = parseFloat(data.ltv);
    const liquidationThreshold = parseFloat(data.liquidationThreshold);
    const liquidationBonus = parseFloat(data.liquidationBonus);
    const interestRate = parseFloat(data.interestRate);
    const reserveFactor = parseFloat(data.reserveFactor);

    // Validate ranges
    if (ltv < 1 || ltv > 95) return 'LTV must be between 1% and 95%';
    if (liquidationThreshold < 1 || liquidationThreshold > 95) return 'Liquidation threshold must be between 1% and 95%';
    if (liquidationBonus < 100 || liquidationBonus > 125) return 'Liquidation bonus must be between 100% and 125%';
    if (interestRate < 0 || interestRate > 100) return 'Interest rate must be between 0% and 100%';
    if (reserveFactor < 0 || reserveFactor > 50) return 'Reserve factor must be between 0% and 50%';

    // Validate relationships
    if (ltv > liquidationThreshold) return 'LTV cannot be higher than liquidation threshold';
    
    return null;
  };

  const onSubmit = async (data: ConfigureAssetFormValues) => {
    if (!token) return;

    const validationError = validateForm(data);
    if (validationError) {
      toast({
        title: 'Validation Error',
        description: validationError,
        variant: 'destructive',
      });
      return;
    }
    
    try {
      const payload = {
        asset: token.address,
        ltv: Math.round(parseFloat(data.ltv) * 100), // Convert to basis points
        liquidationThreshold: Math.round(parseFloat(data.liquidationThreshold) * 100),
        liquidationBonus: Math.round(parseFloat(data.liquidationBonus) * 100),
        interestRate: Math.round(parseFloat(data.interestRate) * 100),
        reserveFactor: Math.round(parseFloat(data.reserveFactor) * 100),
      };

      console.log('Configuring asset with payload:', payload);

      await configureAsset(payload);

      toast({
        title: 'Asset Configuration Updated',
        description: `${token.symbol} has been successfully configured with new parameters`,
      });

      if (onSuccess) {
        await onSuccess();
      }

      form.reset();
      onOpenChange(false);
    } catch (error: unknown) {
      const axiosError = error as AxiosError<any>;
      console.error('Asset configuration error:', axiosError);
      
      toast({
        title: 'Error Configuring Asset',
        description: axiosError.response?.data?.message || (error as Error)?.message || 'Failed to configure asset. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configure Asset Parameters
          </DialogTitle>
          <DialogDescription>
            Configure all lending parameters for {token?.symbol} ({token?.name})
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs defaultValue="risk" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="risk">Risk Parameters</TabsTrigger>
                <TabsTrigger value="rates">Interest & Fees</TabsTrigger>
                <TabsTrigger value="advanced">Advanced</TabsTrigger>
              </TabsList>
              
              <TabsContent value="risk" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Shield className="h-4 w-4" />
                      Risk Management
                    </CardTitle>
                    <CardDescription>
                      Configure collateral and liquidation parameters
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="ltv"
                        rules={{ 
                          required: 'LTV is required',
                          pattern: {
                            value: /^\d+(\.\d{1,2})?$/,
                            message: 'Enter a valid percentage (e.g., 75.5)'
                          }
                        }}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <Percent className="h-4 w-4" />
                              Loan-to-Value (LTV)
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder="75"
                                  {...field}
                                  className="pr-8"
                                />
                                <span className="absolute right-3 top-2.5 text-gray-500">%</span>
                              </div>
                            </FormControl>
                            <FormDescription>
                              Maximum borrowing capacity against collateral (1-95%)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="liquidationThreshold"
                        rules={{ 
                          required: 'Liquidation threshold is required',
                          pattern: {
                            value: /^\d+(\.\d{1,2})?$/,
                            message: 'Enter a valid percentage (e.g., 80.5)'
                          }
                        }}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4" />
                              Liquidation Threshold
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder="80"
                                  {...field}
                                  className="pr-8"
                                />
                                <span className="absolute right-3 top-2.5 text-gray-500">%</span>
                              </div>
                            </FormControl>
                            <FormDescription>
                              Collateral ratio threshold for liquidation (1-95%)
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="liquidationBonus"
                      rules={{ 
                        required: 'Liquidation bonus is required',
                        pattern: {
                          value: /^\d+(\.\d{1,2})?$/,
                          message: 'Enter a valid percentage (e.g., 105.5)'
                        }
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            Liquidation Bonus
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="105"
                                {...field}
                                className="pr-8"
                              />
                              <span className="absolute right-3 top-2.5 text-gray-500">%</span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Bonus for liquidators (100-125%)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="rates" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <TrendingUp className="h-4 w-4" />
                      Interest & Fees
                    </CardTitle>
                    <CardDescription>
                      Configure interest rates and protocol fees
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="interestRate"
                      rules={{ 
                        required: 'Interest rate is required',
                        pattern: {
                          value: /^\d+(\.\d{1,2})?$/,
                          message: 'Enter a valid percentage (e.g., 5.25)'
                        }
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            Interest Rate
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="5.0"
                                {...field}
                                className="pr-8"
                              />
                              <span className="absolute right-3 top-2.5 text-gray-500">%</span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Annual borrowing interest rate (0-100%)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Settings className="h-4 w-4" />
                      Advanced Configuration
                    </CardTitle>
                    <CardDescription>
                      Configure protocol reserve parameters
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="reserveFactor"
                      rules={{ 
                        required: 'Reserve factor is required',
                        pattern: {
                          value: /^\d+(\.\d{1,2})?$/,
                          message: 'Enter a valid percentage (e.g., 10.5)'
                        }
                      }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            Reserve Factor
                          </FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                placeholder="10"
                                {...field}
                                className="pr-8"
                              />
                              <span className="absolute right-3 top-2.5 text-gray-500">%</span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Percentage of interest reserved for protocol (0-50%)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> These parameters directly affect the risk profile of the lending pool. 
                Ensure LTV is less than or equal to liquidation threshold, and all values are within acceptable ranges.
                Only authorized administrators can modify these settings.
              </AlertDescription>
            </Alert>

            <div className="flex justify-end space-x-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={loading || !token}
                className="bg-strato-blue hover:bg-strato-blue/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Configuring Asset...
                  </>
                ) : (
                  'Configure Asset'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default ConfigureAssetModal;
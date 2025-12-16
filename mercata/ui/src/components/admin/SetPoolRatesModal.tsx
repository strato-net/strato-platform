import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Settings, Percent, DollarSign } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Pool } from '@/interface';
import { useState, useEffect } from 'react';
import { useSwapContext } from '@/context/SwapContext';

interface SetPoolRatesFormValues {
  swapFeeRate: string;
  lpSharePercent: string;
}

interface SetPoolRatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pool: Pool | null;
  onSuccess?: () => Promise<void>;
}

const SetPoolRatesModal = ({ 
  open, 
  onOpenChange, 
  pool,
  onSuccess 
}: SetPoolRatesModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const { setPoolRates } = useSwapContext();
  
  const form = useForm<SetPoolRatesFormValues>();

  useEffect(() => {
    if (open && pool) {
      form.reset({
        swapFeeRate: (pool.swapFeeRate / 100).toFixed(2),
        lpSharePercent: (pool.lpSharePercent / 100).toFixed(1),
      });
    }
  }, [open, pool, form]);

  const validateForm = (data: SetPoolRatesFormValues) => {
    const swapFeeRate = parseFloat(data.swapFeeRate);
    const lpSharePercent = parseFloat(data.lpSharePercent);

    // Validate ranges
    if (swapFeeRate < 0 || swapFeeRate > 10) return 'Swap fee rate must be between 0% and 10%';
    if (lpSharePercent < 0 || lpSharePercent > 100) return 'LP share percent must be between 0% and 100%';
    
    return null;
  };

  const onSubmit = async (data: SetPoolRatesFormValues) => {
    if (!pool) return;

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
      setLoading(true);
      await setPoolRates({
        poolAddress: pool.address,
        swapFeeRate: Math.round(parseFloat(data.swapFeeRate) * 100),
        lpSharePercent: Math.round(parseFloat(data.lpSharePercent) * 100),
      });

      toast({
        title: 'Pool Rates Updated',
        description: `${pool.poolName} rates have been successfully updated`,
      });

      if (onSuccess) {
        await onSuccess();
      }

      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to update pool rates',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const currentSwapFee = pool ? (pool.swapFeeRate / 100) : 0;
  const currentLpShare = pool ? (pool.lpSharePercent / 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Set Pool Rates
          </DialogTitle>
          <DialogDescription>
            Configure swap fee rate and LP share percentage for {pool?.poolName}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-4 w-4" />
                  Current Settings
                </CardTitle>
                <CardDescription>
                  Current rates for this pool
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Current Swap Fee:</span>
                    <div className="text-lg font-bold text-blue-600">
                      {currentSwapFee.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Current LP Share:</span>
                    <div className="text-lg font-bold text-green-600">
                      {currentLpShare.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Settings className="h-4 w-4" />
                  New Rate Configuration
                </CardTitle>
                <CardDescription>
                  Set new rates for this liquidity pool
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="swapFeeRate"
                  rules={{ 
                    required: 'Swap fee rate is required',
                    pattern: {
                      value: /^\d*\.?\d{1,2}$/,
                      message: 'Enter a valid percentage (e.g., 0.30 or .30)'
                    }
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Percent className="h-4 w-4" />
                        Swap Fee Rate
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="0.30"
                            {...field}
                            className="pr-8"
                          />
                          <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Fee charged on each swap transaction (0% - 10%)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="lpSharePercent"
                  rules={{ 
                    required: 'LP share percentage is required',
                    pattern: {
                      value: /^\d*\.?\d{1,2}$/,
                      message: 'Enter a valid percentage (e.g., 70.0 or .5)'
                    }
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        LP Share Percentage
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="70.0"
                            {...field}
                            className="pr-8"
                          />
                          <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>
                        Percentage of swap fees distributed to liquidity providers (0% - 100%)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Alert>
              <Settings className="h-4 w-4" />
              <AlertDescription>
                <strong>Important:</strong> These changes will affect the fee distribution for this specific pool. 
                The swap fee rate determines the cost of trading, while the LP share percentage controls how much 
                of the fees go to liquidity providers versus the protocol.
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
                disabled={loading || !pool}
                className="bg-strato-blue hover:bg-strato-blue/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating Rates...
                  </>
                ) : (
                  'Update Pool Rates'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetPoolRatesModal;
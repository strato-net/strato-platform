import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, Settings, TrendingUp } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLendingContext } from '@/context/LendingContext';
import { ApiErrorResponse } from '@/interface';

interface SetInterestRateFormValues {
  rate: string;
}

interface SetInterestRateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: {
    address: string;
    symbol: string;
    name: string;
  } | null;
  currentRate?: string;
  onSuccess?: () => Promise<void>;
}

const SetInterestRateModal = ({ open, onOpenChange, token, currentRate, onSuccess }: SetInterestRateModalProps) => {
  const { toast } = useToast();
  const { setInterestRate } = useLendingContext();
  const [loading, setLoading] = useState(false);
  
  const form = useForm<SetInterestRateFormValues>({
    defaultValues: {
      rate: currentRate?.replace('%', '') || '',
    },
  });

  const watchedRate = form.watch('rate');

  const onSubmit = async (data: SetInterestRateFormValues) => {
    if (!token) return;
    
    setLoading(true);
    try {
      const rateValue = parseFloat(data.rate);
      
      if (isNaN(rateValue) || rateValue < 0 || rateValue > 100) {
        toast({
          title: 'Invalid Rate',
          description: 'Interest rate must be a number between 0 and 100',
          variant: 'destructive',
        });
        return;
      }

      const payload = {
        asset: token.address,
        rate: rateValue,
      };

      console.log('Setting interest rate with payload:', payload);

      await setInterestRate(payload);

      toast({
        title: 'Interest Rate Updated Successfully',
        description: `${token.symbol} interest rate has been set to ${rateValue}%`,
      });

      // Close modal first to prevent flickering
      form.reset();
      onOpenChange(false);

      // Refresh data in background after modal closes
      if (onSuccess) {
        setTimeout(() => onSuccess(), 100);
      }
    } catch (error: unknown) {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      console.error('Interest rate error:', axiosError);
      
      toast({
        title: 'Error Setting Interest Rate',
        description: axiosError.response?.data?.message || (error as Error)?.message || 'Failed to set interest rate. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Set Interest Rate
          </DialogTitle>
          <DialogDescription>
            Update the interest rate for {token?.symbol} ({token?.name})
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="rate"
              rules={{ 
                required: 'Interest rate is required',
                pattern: {
                  value: /^\d*\.?\d+$/,
                  message: 'Please enter a valid number'
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Annual Interest Rate (%)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type="number"
                        placeholder="5.0"
                        min="0"
                        max="100"
                        step="0.01"
                        {...field}
                        className="pr-8"
                      />
                      <TrendingUp className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Set the annual interest rate for borrowing this asset (0-100%)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {token && watchedRate && (
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  You are about to set the interest rate of <strong>{token.symbol}</strong> to <strong>{watchedRate}%</strong> annually.
                  {currentRate && ` Current rate: ${currentRate}`}
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The interest rate determines the cost of borrowing this asset. Higher rates reduce borrowing 
                demand but increase returns for lenders. This rate affects the platform's risk-return profile 
                and borrower incentives.
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
                    Updating Rate...
                  </>
                ) : (
                  'Update Interest Rate'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetInterestRateModal;
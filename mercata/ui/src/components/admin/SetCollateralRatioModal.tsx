import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, Settings, Percent } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLendingContext } from '@/context/LendingContext';

interface SetCollateralRatioFormValues {
  ratio: string;
}

interface SetCollateralRatioModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: {
    address: string;
    symbol: string;
    name: string;
  } | null;
  currentRatio?: string;
  onSuccess?: () => Promise<void>;
}

const SetCollateralRatioModal = ({ open, onOpenChange, token, currentRatio, onSuccess }: SetCollateralRatioModalProps) => {
  const { toast } = useToast();
  const { setCollateralRatio } = useLendingContext();
  const [loading, setLoading] = useState(false);
  
  const form = useForm<SetCollateralRatioFormValues>({
    defaultValues: {
      ratio: currentRatio?.replace('%', '') || '',
    },
  });

  const watchedRatio = form.watch('ratio');

  const onSubmit = async (data: SetCollateralRatioFormValues) => {
    if (!token) return;
    
    setLoading(true);
    try {
      const ratioValue = parseFloat(data.ratio);
      
      if (isNaN(ratioValue) || ratioValue < 100 || ratioValue > 1000) {
        toast({
          title: 'Invalid Ratio',
          description: 'Collateral ratio must be a number between 100 and 1000',
          variant: 'destructive',
        });
        return;
      }

      const payload = {
        asset: token.address,
        ratio: ratioValue,
      };

      console.log('Setting collateral ratio with payload:', payload);

      await setCollateralRatio(payload);

      toast({
        title: 'Collateral Ratio Updated Successfully',
        description: `${token.symbol} collateral ratio has been set to ${ratioValue}%`,
      });

      // Refresh data to show updated values
      if (onSuccess) {
        await onSuccess();
      }

      form.reset();
      onOpenChange(false);
    } catch (error: unknown) {
      const axiosError = error as AxiosError<any>;
      console.error('Collateral ratio error:', axiosError);
      
      toast({
        title: 'Error Setting Collateral Ratio',
        description: axiosError.response?.data?.message || (error as Error)?.message || 'Failed to set collateral ratio. Please try again.',
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
            <Percent className="h-5 w-5" />
            Set Collateral Ratio
          </DialogTitle>
          <DialogDescription>
            Update the collateral ratio for {token?.symbol} ({token?.name})
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="ratio"
              rules={{ 
                required: 'Collateral ratio is required',
                pattern: {
                  value: /^\d*\.?\d+$/,
                  message: 'Please enter a valid number'
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Collateral Ratio (%)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type="number"
                        placeholder="150"
                        min="100"
                        max="1000"
                        step="0.01"
                        {...field}
                        className="pr-8"
                      />
                      <Percent className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Set the minimum collateral ratio required for borrowing against this asset (100-1000%)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {token && watchedRatio && (
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  You are about to set the collateral ratio of <strong>{token.symbol}</strong> to <strong>{watchedRatio}%</strong>.
                  {currentRatio && ` Current ratio: ${currentRatio}`}
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The collateral ratio determines how much collateral is required relative to the borrowed amount. 
                A higher ratio means borrowers need more collateral to secure their loans. This setting affects 
                risk management and borrowing capacity across the platform.
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
                    Updating Ratio...
                  </>
                ) : (
                  'Update Collateral Ratio'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetCollateralRatioModal;
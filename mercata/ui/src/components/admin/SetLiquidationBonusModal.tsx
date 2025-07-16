import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, Settings, Shield } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLendingContext } from '@/context/LendingContext';
import { ApiErrorResponse } from '@/interface';

interface SetLiquidationBonusFormValues {
  bonus: string;
}

interface SetLiquidationBonusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: {
    address: string;
    symbol: string;
    name: string;
  } | null;
  currentBonus?: string;
  onSuccess?: () => Promise<void>;
}

const SetLiquidationBonusModal = ({ open, onOpenChange, token, currentBonus, onSuccess }: SetLiquidationBonusModalProps) => {
  const { toast } = useToast();
  const { setLiquidationBonus } = useLendingContext();
  const [loading, setLoading] = useState(false);
  
  const form = useForm<SetLiquidationBonusFormValues>({
    defaultValues: {
      bonus: currentBonus?.replace('%', '') || '',
    },
  });

  const watchedBonus = form.watch('bonus');

  const onSubmit = async (data: SetLiquidationBonusFormValues) => {
    if (!token) return;
    
    setLoading(true);
    try {
      const bonusValue = parseFloat(data.bonus);
      
      if (isNaN(bonusValue) || bonusValue < 100 || bonusValue > 200) {
        toast({
          title: 'Invalid Bonus',
          description: 'Liquidation bonus must be a number between 100 and 200',
          variant: 'destructive',
        });
        return;
      }

      const payload = {
        asset: token.address,
        bonus: bonusValue,
      };

      console.log('Setting liquidation bonus with payload:', payload);

      await setLiquidationBonus(payload);

      toast({
        title: 'Liquidation Bonus Updated Successfully',
        description: `${token.symbol} liquidation bonus has been set to ${bonusValue}%`,
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
      console.error('Liquidation bonus error:', axiosError);
      
      toast({
        title: 'Error Setting Liquidation Bonus',
        description: axiosError.response?.data?.message || (error as Error)?.message || 'Failed to set liquidation bonus. Please try again.',
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
            <Shield className="h-5 w-5" />
            Set Liquidation Bonus
          </DialogTitle>
          <DialogDescription>
            Update the liquidation bonus for {token?.symbol} ({token?.name})
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="bonus"
              rules={{ 
                required: 'Liquidation bonus is required',
                pattern: {
                  value: /^\d*\.?\d+$/,
                  message: 'Please enter a valid number'
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Liquidation Bonus (%)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type="number"
                        placeholder="105"
                        min="100"
                        max="200"
                        step="0.01"
                        {...field}
                        className="pr-8"
                      />
                      <Shield className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Set the liquidation bonus percentage for liquidators (100-200%)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {token && watchedBonus && (
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  You are about to set the liquidation bonus of <strong>{token.symbol}</strong> to <strong>{watchedBonus}%</strong>.
                  {currentBonus && ` Current bonus: ${currentBonus}`}
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The liquidation bonus incentivizes liquidators to maintain protocol health by providing 
                additional collateral when liquidating undercollateralized positions. Higher bonuses 
                attract more liquidators but reduce borrower returns.
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
                    Updating Bonus...
                  </>
                ) : (
                  'Update Liquidation Bonus'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetLiquidationBonusModal;
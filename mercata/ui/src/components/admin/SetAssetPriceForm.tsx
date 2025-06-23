import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PriceFormValues } from '@/interface';
import { Loader2, Info, DollarSign} from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLendingContext } from '@/context/LendingContext';
import { useTokenContext } from '@/context/TokenContext';


const SetAssetPriceForm = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { activeTokens, getActiveTokens, loading: tokensLoading } = useTokenContext();
  const { setPrice } = useLendingContext();
  
  const form = useForm<PriceFormValues>({
    defaultValues: {
      tokenAddress: '',
      price: '',
    },
  });

  const selectedToken = Array.isArray(activeTokens) ? activeTokens.find(t => t.address === form.watch('tokenAddress')) : null;

  useEffect(() => {
    getActiveTokens();
  }, [getActiveTokens]);

  const onSubmit = async (data: PriceFormValues) => {
    setLoading(true);
    try {
      const payload = {
        token: data.tokenAddress,
        price: data.price,
      };

      await setPrice(payload);

      console.log('Setting price with payload:', payload);
      console.log('Selected token:', selectedToken);

      toast({
        title: 'Price Updated Successfully',
        description: `Price for ${selectedToken?._symbol} has been set to $${data.price}`,
      });

      form.reset();
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      toast({
        title: 'Error Setting Price',
        description: axiosError.response?.data?.message || 'Failed to set price. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="tokenAddress"
              rules={{ required: 'Token selection is required' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Token</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a token" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Array.isArray(activeTokens) && activeTokens.map((token) => {
                        return (
                          <SelectItem key={token.address} value={token.address}>
                            <div className="flex items-center justify-between w-full">
                              <span>{token._symbol} - {token._name} ({token.address})</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the token to update pricing for
                  </FormDescription>
                  {selectedToken && (
                    <div className="text-base font-medium text-gray-700 mt-1">
                      Current price: $
                      {(() => {
                        try {
                          return parseFloat(
                            (Number(selectedToken.price) / 1e18).toString()
                          ).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
                        } catch {
                          return "-";
                        }
                      })()}
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="price"
              rules={{ 
                required: 'Price is required',
                pattern: {
                  value: /^\d+\.?\d*$/,
                  message: 'Must be a valid price'
                },
                min: {
                  value: 0.000001,
                  message: 'Price must be greater than 0'
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Price (USD)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                      <Input className="pl-10" placeholder="0.00" {...field} />
                    </div>
                  </FormControl>
                  <FormDescription>
                    Set the new price in USD
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Setting asset prices will affect all calculations across the platform including 
              collateral values, swap rates, and lending APYs. This action should be performed 
              carefully and regularly to reflect accurate market conditions.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset()}
              disabled={loading}
            >
              Reset
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating Price...
                </>
              ) : (
                'Update Price'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default SetAssetPriceForm;
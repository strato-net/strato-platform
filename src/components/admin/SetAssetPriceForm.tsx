import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PriceFormValues, Token } from '@/interface';
import { Loader2, Info, DollarSign} from 'lucide-react';
import {api} from '@/lib/axios';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLendingContext } from '@/context/LendingContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { useUser } from '@/context/UserContext';


const SetAssetPriceForm = () => {
  const [loading, setLoading] = useState(false);
  const [tokensWithPrices, setTokensWithPrices] = useState<any[]>([]);
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { tokens, loading: tokensLoading, fetchTokens } = useUserTokens();
  const { setPrice } = useLendingContext();
  
  const form = useForm<PriceFormValues>({
    defaultValues: {
      tokenAddress: '',
      price: '',
    },
  });

  const selectedToken = Array.isArray(tokens) ? tokens.find(t => t.address === form.watch('tokenAddress')) : null;

  useEffect(() => {
    fetchTokensWithPrices();
    if (userAddress) {
      fetchTokens(userAddress);
    }
  }, [userAddress]);

  const fetchTokensWithPrices = async () => {
    try {
      const response = await api.get('/admin/tokens/prices');
      const tokenData = Array.isArray(response.data) ? response.data : [];
      setTokensWithPrices(tokenData);
      
      if (!Array.isArray(response.data)) {
        console.error('Expected array of token prices but got:', response.data);
      }
    } catch (error) {
      console.error('Error fetching token prices:', error);
      setTokensWithPrices([]);
    }
  };

  const onSubmit = async (data: PriceFormValues) => {
    setLoading(true);
    try {
      const payload = {
        token: data.tokenAddress,
        price: data.price,
      };

      await setPrice(payload);

      toast({
        title: 'Price Updated Successfully',
        description: `Price for ${selectedToken?._symbol} has been set to $${data.price}`,
      });

      form.reset();
      fetchTokensWithPrices(); // Refresh prices
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
                      {Array.isArray(tokens) && tokens.map((token) => {
                        return (
                          <SelectItem key={token.address} value={token.address}>
                            <div className="flex items-center justify-between w-full">
                              <span>{token.token._symbol} - {token.token._name}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the token to update pricing for
                  </FormDescription>
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

      {/* Price History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Price Updates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-500 text-center py-4">
            Price history will be displayed here once available
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SetAssetPriceForm;
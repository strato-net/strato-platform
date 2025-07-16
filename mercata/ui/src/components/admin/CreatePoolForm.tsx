import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { PoolFormValues } from '@/interface';
import { Loader2, Info, Droplets } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSwapContext } from '@/context/SwapContext';
import { useTokenContext } from '@/context/TokenContext';

const CreatePoolForm = () => {
  const { createPool, loading: swapLoading } = useSwapContext();
  const { activeTokens, getActiveTokens, loading: tokenLoading } = useTokenContext();
  const { toast } = useToast();
  
  const loading = swapLoading || tokenLoading;
  
  const form = useForm<PoolFormValues>({
    defaultValues: {
      tokenA: '',
      tokenB: '',
      // initialLiquidityA: '',
      // initialLiquidityB: '',
      // poolName: '',
    },
  });

  useEffect(() => {
    getActiveTokens();
  }, [getActiveTokens]);

  const onSubmit = async (data: PoolFormValues) => {
    if (data.tokenA === data.tokenB) {
      toast({
        title: 'Invalid Pool Configuration',
        description: 'Please select two different tokens for the pool.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createPool({
        tokenA: data.tokenA,
        tokenB: data.tokenB,
      });

      // After creating the pool, add initial liquidity if provided
      // Note: This might need to be handled separately with addLiquidity method
      // depending on how the backend handles pool creation

      toast({
        title: 'Pool Created Successfully',
        description: `Swap pool for ${data.tokenA}/${data.tokenB} has been created.`,
      });

      form.reset();
    } catch (error) {
      toast({
        title: 'Error Creating Pool',
        description: error?.message || 'Failed to create pool. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="tokenA"
            rules={{ required: 'First token is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Token A</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select first token" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {activeTokens && activeTokens.map((token) => (
                      <SelectItem key={token.address} value={token.address}>
                        {token?._symbol} - {token?._name} ({token.address})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  The first token in the trading pair
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tokenB"
            rules={{ required: 'Second token is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Token B</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select second token" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {activeTokens.map((token) => (
                      <SelectItem key={token.address} value={token.address}>
                        {token?._symbol} - {token?._name} ({token.address})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  The second token in the trading pair
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* <FormField
            control={form.control}
            name="initialLiquidityA"
            rules={{ 
              required: 'Initial liquidity is required',
              pattern: {
                value: /^\d+\.?\d*$/,
                message: 'Must be a valid number'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initial Liquidity (Token A)</FormLabel>
                <FormControl>
                  <Input placeholder="1000" {...field} />
                </FormControl>
                <FormDescription>
                  Amount of first token to add to the pool
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="initialLiquidityB"
            rules={{ 
              required: 'Initial liquidity is required',
              pattern: {
                value: /^\d+\.?\d*$/,
                message: 'Must be a valid number'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initial Liquidity (Token B)</FormLabel>
                <FormControl>
                  <Input placeholder="1000" {...field} />
                </FormControl>
                <FormDescription>
                  Amount of second token to add to the pool
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="poolName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pool Name (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="GOLD/USDST Pool" {...field} />
                </FormControl>
                <FormDescription>
                  Custom name for the pool
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          /> */}
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Creating a pool will deploy a new liquidity pool contract. The initial liquidity 
            will be transferred from your admin wallet to the pool. Make sure you have sufficient 
            balance of both tokens.
          </AlertDescription>
        </Alert>

        <div className="flex items-center space-x-2 text-sm text-gray-600">
          <Droplets className="h-4 w-4" />
          <span>
            The initial exchange rate will be determined by the ratio of initial liquidity amounts.
          </span>
        </div>

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
                Creating Pool...
              </>
            ) : (
              'Create Pool'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CreatePoolForm;
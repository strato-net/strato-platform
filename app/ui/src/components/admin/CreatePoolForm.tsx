import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CreatePoolParams } from '@/interface';
import { Loader2, Info, Droplets } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSwapContext } from '@/context/SwapContext';
import { useTokenContext, TOKENS_LIST_MAX_LIMIT } from '@/context/TokenContext';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import CreatePoolV3Form from './CreatePoolV3Form';

type PoolType = 'classic' | 'stable' | 'v3';

const POOL_TYPES: { value: PoolType; label: string; description: string }[] = [
  { value: 'classic', label: 'Constant Product', description: 'Traditional V2 pool (x·y=k)' },
  { value: 'stable', label: 'Stable', description: 'Stable swap pool for pegged assets' },
  { value: 'v3', label: 'Concentrated (V3)', description: 'Concentrated-liquidity pool with fee tiers' },
];

const CreatePoolForm = () => {
  const [poolType, setPoolType] = useState<PoolType>('classic');
  const { createPool, loading: swapLoading } = useSwapContext();
  const { activeTokens, getActiveTokens, loading: tokenLoading } = useTokenContext();
  const { toast } = useToast();

  const loading = swapLoading || tokenLoading;

  const form = useForm<CreatePoolParams>({
    defaultValues: {
      tokenA: '',
      tokenB: '',
      // initialLiquidityA: '',
      // initialLiquidityB: '',
      // poolName: '',
    },
  });

  useEffect(() => {
    getActiveTokens(1, TOKENS_LIST_MAX_LIMIT);
  }, [getActiveTokens]);

  const onSubmit = async (data: CreatePoolParams) => {
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
        isStable: poolType === 'stable',
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
      // Error toast is now handled globally by axios interceptor
    }
  };

  const poolTypeSelector = (
    <div className="space-y-3">
      <Label>Pool Type</Label>
      <RadioGroup
        value={poolType}
        onValueChange={(value) => setPoolType(value as PoolType)}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {POOL_TYPES.map((type) => (
          <div key={type.value} className="flex items-start space-x-2">
            <RadioGroupItem value={type.value} id={`pool-type-${type.value}`} className="mt-1" />
            <Label htmlFor={`pool-type-${type.value}`} className="font-normal cursor-pointer">
              <span className="font-medium block">{type.label}</span>
              <span className="text-sm text-muted-foreground">{type.description}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );

  if (poolType === 'v3') {
    return (
      <div className="space-y-6">
        {poolTypeSelector}
        <CreatePoolV3Form />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {poolTypeSelector}
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

        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
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
    </div>
  );
};

export default CreatePoolForm;
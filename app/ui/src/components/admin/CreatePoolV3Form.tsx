import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { PoolV3, PoolV3FeeTier } from '@/interface';
import { Loader2, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSwapContext } from '@/context/SwapContext';
import { useTokenContext } from '@/context/TokenContext';

/** fee in pips (1e6 denominator) as a percentage, e.g. 3000 -> "0.30%" */
const feeLabel = (fee: number) =>
  `${(fee / 10000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

interface CreatePoolV3FormValues {
  tokenA: string;
  tokenB: string;
  fee: string;
  price: string;
}

const CreatePoolV3Form = () => {
  const { createV3Pool, fetchV3Pools, fetchV3FeeTiers, loading: swapLoading } = useSwapContext();
  const { activeTokens, getActiveTokens, loading: tokenLoading } = useTokenContext();
  const { toast } = useToast();
  const [v3Pools, setV3Pools] = useState<PoolV3[]>([]);
  const [feeTiers, setFeeTiers] = useState<PoolV3FeeTier[]>([]);

  const loading = swapLoading || tokenLoading;

  const form = useForm<CreatePoolV3FormValues>({
    defaultValues: {
      tokenA: '',
      tokenB: '',
      fee: '3000',
      price: '',
    },
  });

  const refreshV3Pools = useCallback(async () => {
    setV3Pools(await fetchV3Pools());
  }, [fetchV3Pools]);

  useEffect(() => {
    getActiveTokens();
    refreshV3Pools();
    // Enabled tiers come from the factory's feeTiers mapping — they can be added
    // on-chain, so fall back to the first one when the default is not enabled.
    fetchV3FeeTiers().then((tiers) => {
      setFeeTiers(tiers);
      if (tiers.length > 0 && !tiers.some((tier) => String(tier.fee) === form.getValues('fee'))) {
        form.setValue('fee', String(tiers[0].fee));
      }
    });
  }, [getActiveTokens, refreshV3Pools, fetchV3FeeTiers, form]);

  const tokenA = form.watch('tokenA');
  const tokenB = form.watch('tokenB');
  const fee = form.watch('fee');
  const price = form.watch('price');

  const symbolOf = (address: string) =>
    activeTokens?.find((token) => token.address === address)?._symbol;
  const symbolA = symbolOf(tokenA) || 'Token A';
  const symbolB = symbolOf(tokenB) || 'Token B';

  // The factory registers each pool under both token orderings, so a duplicate
  // is any existing pool with the same unordered pair at the same fee tier.
  const isDuplicate = !!tokenA && !!tokenB && v3Pools.some((pool) => {
    if (pool.fee !== Number(fee)) return false;
    const t0 = pool.token0.address.toLowerCase();
    const t1 = pool.token1.address.toLowerCase();
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    return (t0 === a && t1 === b) || (t0 === b && t1 === a);
  });

  const priceNumber = Number(price);
  const inversePrice = priceNumber > 0 && Number.isFinite(priceNumber)
    ? (1 / priceNumber).toLocaleString(undefined, { maximumSignificantDigits: 6 })
    : null;

  const onSubmit = async (data: CreatePoolV3FormValues) => {
    if (data.tokenA === data.tokenB) {
      toast({
        title: 'Invalid Pool Configuration',
        description: 'Please select two different tokens for the pool.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createV3Pool({
        tokenA: data.tokenA,
        tokenB: data.tokenB,
        fee: Number(data.fee),
        price: data.price.trim(),
      });

      toast({
        title: 'V3 Pool Creation Submitted',
        description: `${symbolA}/${symbolB} at ${feeLabel(Number(data.fee))}. If a governance vote is required, the pool appears once it executes.`,
      });

      form.reset();
      refreshV3Pools();
    } catch (error) {
      // Error toast is handled globally by axios interceptor
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
                <Select onValueChange={field.onChange} value={field.value}>
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
                <Select onValueChange={field.onChange} value={field.value}>
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

          <FormField
            control={form.control}
            name="fee"
            rules={{ required: 'Fee tier is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fee Tier</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select fee tier" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {feeTiers.map((tier) => (
                      <SelectItem key={tier.fee} value={String(tier.fee)}>
                        {feeLabel(tier.fee)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Swap fee collected by the pool. The same pair can have one pool per fee tier.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="price"
            rules={{
              required: 'Initial price is required',
              pattern: {
                value: /^\d+(\.\d+)?$/,
                message: 'Must be a valid number',
              },
              validate: (value) => Number(value) > 0 || 'Price must be greater than zero',
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Initial Price — 1 {symbolA} = ? {symbolB}</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. 2000" {...field} />
                </FormControl>
                <FormDescription>
                  {inversePrice
                    ? `1 ${symbolB} = ${inversePrice} ${symbolA}`
                    : `How much ${symbolB} one ${symbolA} is worth at pool creation`}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {isDuplicate && (
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              A V3 pool for {symbolA}/{symbolB} at this fee tier already exists. Choose a
              different fee tier or token pair.
            </AlertDescription>
          </Alert>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Creating a V3 pool deploys a new concentrated-liquidity pool contract at the
            initial price you set. The pool starts empty — liquidity is added afterwards
            as positions on the Trade page.
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
            disabled={loading || isDuplicate}
            className="bg-strato-blue hover:bg-strato-blue/90"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Pool...
              </>
            ) : (
              'Create V3 Pool'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CreatePoolV3Form;

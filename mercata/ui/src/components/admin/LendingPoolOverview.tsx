import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/axios';
import { Loader2, Shield, Info, ArrowUpRight } from 'lucide-react';

interface DebtCeilingFormValues {
  assetUnits: string;
  usdValue: string;
}

interface SweepReservesFormValues {
  amount: string;
}

const LendingPoolOverview = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const debtCeilingForm = useForm<DebtCeilingFormValues>({
    defaultValues: {
      assetUnits: '',
      usdValue: '',
    },
  });

  const sweepReservesForm = useForm<SweepReservesFormValues>({
    defaultValues: {
      amount: '',
    },
  });

  const onSubmitDebtCeiling = async (data: DebtCeilingFormValues) => {
    setLoading(true);
    try {
      await api.post('/lend/admin/set-debt-ceilings', {
        assetUnits: data.assetUnits,
        usdValue: BigInt(Math.floor(parseFloat(data.usdValue) * 1e18)).toString(),
      });
      
      toast({
        title: 'Debt Ceilings Updated',
        description: `Debt ceilings have been configured.`,
      });

      debtCeilingForm.reset();
    } catch (error: any) {
      toast({
        title: 'Error Setting Debt Ceilings',
        description: error?.response?.data?.message || error?.message || 'Failed to set debt ceilings. This feature may not be implemented in the current smart contract version.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const onSubmitSweepReserves = async (data: SweepReservesFormValues) => {
    setLoading(true);
    try {
      await api.post('/lend/admin/sweep-reserves', {
        amount: data.amount,
      });
      
      toast({
        title: 'Reserves Swept Successfully',
        description: `${data.amount} units swept to fee collector.`,
      });

      sweepReservesForm.reset();
    } catch (error: any) {
      toast({
        title: 'Error Sweeping Reserves',
        description: error?.response?.data?.message || error?.message || 'Failed to sweep reserves. This feature may not be implemented in the current smart contract version.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Set Debt Ceilings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Set Debt Ceilings</span>
          </CardTitle>
          <CardDescription>
            Configure system-wide debt limits to manage protocol risk
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...debtCeilingForm}>
            <form onSubmit={debtCeilingForm.handleSubmit(onSubmitDebtCeiling)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={debtCeilingForm.control}
                  name="assetUnits"
                  rules={{ 
                    required: 'Asset units ceiling is required',
                    pattern: {
                      value: /^\d+$/,
                      message: 'Must be a valid number'
                    }
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Units Ceiling</FormLabel>
                      <FormControl>
                        <Input placeholder={(1_000_000n * 10n ** 18n).toString()} {...field} />
                      </FormControl>
                      <FormDescription>
                        Maximum borrowable amount in asset units (0 = no limit)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={debtCeilingForm.control}
                  name="usdValue"
                  rules={{ 
                    required: 'USD value ceiling is required',
                    pattern: {
                      value: /^\d+\.?\d*$/,
                      message: 'Must be a valid number'
                    }
                  }}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>USD Value Ceiling</FormLabel>
                      <FormControl>
                        <Input placeholder="1000000.00" {...field} />
                      </FormControl>
                      <FormDescription>
                        Maximum borrowable amount in USD value (0 = no limit)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  Debt ceilings provide system-wide protection against excessive borrowing. 
                  Set to 0 to disable a particular ceiling. Both limits are enforced simultaneously.
                </AlertDescription>
              </Alert>

              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => debtCeilingForm.reset()}
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
                      Setting...
                    </>
                  ) : (
                    'Set Debt Ceilings'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Sweep Reserves */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <ArrowUpRight className="h-5 w-5" />
            <span>Sweep Reserves</span>
          </CardTitle>
          <CardDescription>
            Transfer protocol reserves from the LendingPool to the FeeCollector
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...sweepReservesForm}>
            <form onSubmit={sweepReservesForm.handleSubmit(onSubmitSweepReserves)} className="space-y-6">
              <FormField
                control={sweepReservesForm.control}
                name="amount"
                rules={{ 
                  required: 'Amount is required',
                  pattern: {
                    value: /^\d+$/,
                    message: 'Must be a valid number'
                  }
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount to Sweep</FormLabel>
                    <FormControl>
                      <Input placeholder={(1n * 10n ** 18n).toString()} {...field} />
                    </FormControl>
                    <FormDescription>
                      Amount of reserves (in asset units) to sweep to fee collector
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  This action transfers accumulated protocol reserves to the fee collector. 
                  The LendingPool enforces bounds and accrual automatically. 
                  Only available reserves can be swept.
                </AlertDescription>
              </Alert>

              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sweepReservesForm.reset()}
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
                      Sweeping...
                    </>
                  ) : (
                    'Sweep Reserves'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export default LendingPoolOverview;
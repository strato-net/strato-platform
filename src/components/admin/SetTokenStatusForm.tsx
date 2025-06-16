import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, Settings } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUserTokens } from '@/context/UserTokensContext';
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';

interface SetTokenStatusFormValues {
  tokenAddress: string;
  status: number;
}

const TOKEN_STATUS_OPTIONS = [
  { value: 1, label: 'PENDING', description: 'Token is pending approval' },
  { value: 2, label: 'ACTIVE', description: 'Token is active and tradeable' },
  { value: 3, label: 'LEGACY', description: 'Token is deprecated but still functional' },
];

const SetTokenStatusForm = () => {
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { tokens, loading: tokensLoading, fetchTokens } = useUserTokens();
  const { setTokenStatus, loading, error } = useTokenContext();
  
  const form = useForm<SetTokenStatusFormValues>({
    defaultValues: {
      tokenAddress: '',
      status: 1,
    },
  });

  const selectedToken = Array.isArray(tokens) ? tokens.find(t => t.address === form.watch('tokenAddress')) : null;
  const selectedStatus = TOKEN_STATUS_OPTIONS.find(s => s.value === form.watch('status'));

  useEffect(() => {
    if (userAddress) {
      fetchTokens(userAddress);
    }
  }, [userAddress]);

  const onSubmit = async (data: SetTokenStatusFormValues) => {
    try {
      const payload = {
        address: data.tokenAddress,
        status: data.status,
      };

      console.log('Setting token status with payload:', payload);

      await setTokenStatus(payload);

      toast({
        title: 'Token Status Updated Successfully',
        description: `${selectedToken?.token?._symbol || selectedToken?._symbol} status has been set to ${selectedStatus?.label}`,
      });

      form.reset();
    } catch (error: unknown) {
      const axiosError = error as AxiosError<any>;
      console.error('Token status error:', axiosError);
      
      toast({
        title: 'Error Setting Token Status',
        description: axiosError.response?.data?.message || error?.message || 'Failed to set token status. Please try again.',
        variant: 'destructive',
      });
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
                      {tokensLoading ? (
                        <SelectItem value="loading" disabled>
                          Loading tokens...
                        </SelectItem>
                      ) : Array.isArray(tokens) && tokens.length > 0 ? (
                        tokens.map((token) => (
                          <SelectItem key={token.address} value={token.address}>
                            <div className="flex items-center justify-between w-full">
                              <span>{token.token?._symbol || token._symbol} - {token.token?._name || token._name}</span>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-tokens" disabled>
                          No tokens available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the token to update status for
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="status"
              rules={{ required: 'Status selection is required' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Status</FormLabel>
                  <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TOKEN_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value.toString()}>
                          <div className="flex flex-col">
                            <span className="font-medium">{status.label}</span>
                            <span className="text-xs text-gray-500">{status.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Set the new status for the token
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {selectedToken && selectedStatus && (
            <Alert>
              <Settings className="h-4 w-4" />
              <AlertDescription>
                You are about to change the status of <strong>{selectedToken.token?._symbol || selectedToken._symbol}</strong> to <strong>{selectedStatus.label}</strong>. 
                {selectedStatus.description && ` ${selectedStatus.description}.`}
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Changing token status affects how the token behaves across the platform. Only the TokenFactory 
              contract can call this function. Ensure you have the proper permissions before attempting this operation.
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
              disabled={loading || !selectedToken}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating Status...
                </>
              ) : (
                'Update Token Status'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default SetTokenStatusForm;
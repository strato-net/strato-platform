import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, Settings } from 'lucide-react';
import { AxiosError } from 'axios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTokenContext } from '@/context/TokenContext';
import { ApiErrorResponse } from '@/interface';

interface SetTokenStatusFormValues {
  status: number;
}

interface SetTokenStatusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: {
    address: string;
    symbol: string;
    name: string;
  } | null;
}

const TOKEN_STATUS_OPTIONS = [
  { value: 1, label: 'PENDING', description: 'Token is pending approval' },
  { value: 2, label: 'ACTIVE', description: 'Token is active and tradeable' },
  { value: 3, label: 'LEGACY', description: 'Token is deprecated but still functional' },
];

const SetTokenStatusModal = ({ open, onOpenChange, token }: SetTokenStatusModalProps) => {
  const { toast } = useToast();
  const { setTokenStatus, loading } = useTokenContext();
  
  const form = useForm<SetTokenStatusFormValues>({
    defaultValues: {
      status: 1,
    },
  });

  const selectedStatus = TOKEN_STATUS_OPTIONS.find(s => s.value === form.watch('status'));

  const onSubmit = async (data: SetTokenStatusFormValues) => {
    if (!token) return;
    
    try {
      const payload = {
        address: token.address,
        status: data.status,
      };
      await setTokenStatus(payload);

      toast({
        title: 'Token Status Updated Successfully',
        description: `${token.symbol} status has been set to ${selectedStatus?.label}`,
      });

      form.reset();
      onOpenChange(false);
    } catch (error: unknown) {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      console.error('Token status error:', axiosError);
      // Error toast is now handled globally by axios interceptor
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Set Token Status</DialogTitle>
          <DialogDescription>
            Update the status for {token?.symbol} ({token?.name})
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

            {token && selectedStatus && (
              <Alert>
                <Settings className="h-4 w-4" />
                <AlertDescription>
                  You are about to change the status of <strong>{token.symbol}</strong> to <strong>{selectedStatus.label}</strong>. 
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
                    Updating Status...
                  </>
                ) : (
                  'Update Token Status'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default SetTokenStatusModal;
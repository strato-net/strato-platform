import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RemoveAdminFormValues = {
  userAddress: string;
};

interface RemoveAdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveAdmin: (userAddress: string) => Promise<void>;
  admins: Array<{ address: string }>;
}

const RemoveAdminModal: React.FC<RemoveAdminModalProps> = ({
  open,
  onOpenChange,
  onRemoveAdmin,
  admins,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RemoveAdminFormValues>({
    defaultValues: {
      userAddress: '',
    },
    mode: 'onChange',
  });

  const onSubmit = async (values: RemoveAdminFormValues) => {
    setIsSubmitting(true);
    try {
      await onRemoveAdmin(values.userAddress);

      toast({
        title: 'Issue to Remove Admin Created',
        description: 'Your admin issue has been submitted for voting.',
      });

      form.reset({ userAddress: '' });
      onOpenChange(false);
    } catch (err) {
      console.error('Remove admin failed:', err);
      toast({
        title: 'Failed to remove admin',
        description: err instanceof Error ? err.message : 'Please check the address and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Remove Admin</DialogTitle>
          <DialogDescription>
            Select the admin you want to revoke administrator rights from.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* User Address */}
            <FormField
              control={form.control}
              name="userAddress"
              rules={{
                required: 'Please select an admin to remove',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Admin to Remove</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono">
                        <SelectValue placeholder="Select an admin..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {admins.length === 0 ? (
                        <SelectItem value="no-admins" disabled>
                          No admins available
                        </SelectItem>
                      ) : (
                        admins.map((admin) => (
                          <SelectItem 
                            key={admin.address} 
                            value={admin.address}
                            className="font-mono"
                          >
                            {admin.address}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !form.formState.isValid}
                className="bg-red-600 hover:bg-red-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Removing Admin...
                  </>
                ) : (
                  'Remove Admin'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default RemoveAdminModal;


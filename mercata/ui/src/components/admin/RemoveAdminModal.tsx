import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RemoveAdminFormValues = {
  userAddress: string;
};

interface RemoveAdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveAdmin: (userAddress: string) => Promise<void>;
}

const RemoveAdminModal: React.FC<RemoveAdminModalProps> = ({
  open,
  onOpenChange,
  onRemoveAdmin,
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
    const trimmedAddress = values.userAddress.trim();

    setIsSubmitting(true);
    try {
      await onRemoveAdmin(trimmedAddress);

      toast({
        title: 'Admin Removed Successfully',
        description: 'The admin has been removed from the registry.',
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
            Enter the address of the admin you want to revoke administrator rights from.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* User Address */}
            <FormField
              control={form.control}
              name="userAddress"
              rules={{
                required: 'User address is required',
                validate: (v) => {
                  const trimmed = v.trim();
                  if (trimmed.length === 0) return 'User address cannot be empty';
                  if (!/^[a-fA-F0-9]{40}$/.test(trimmed)) {
                    return 'Please enter a valid 40-character hexadecimal address';
                  }
                  return true;
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>User Address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="font-mono"
                    />
                  </FormControl>
                  
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


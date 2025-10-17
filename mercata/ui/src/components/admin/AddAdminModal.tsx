import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type AddAdminFormValues = {
  userAddress: string;
};

interface AddAdminModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddAdmin: (userAddress: string) => Promise<void>;
  admins: Array<{ address: string }>;
}

const AddAdminModal: React.FC<AddAdminModalProps> = ({
  open,
  onOpenChange,
  onAddAdmin,
  admins,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AddAdminFormValues>({
    defaultValues: {
      userAddress: '',
    },
    mode: 'onChange',
  });

  const onSubmit = async (values: AddAdminFormValues) => {
    const trimmedAddress = values.userAddress.trim();

    setIsSubmitting(true);
    try {
      await onAddAdmin(trimmedAddress);

      toast({
        title: 'Issue to Add Admin Created',
        description: 'Your admin issue has been submitted for voting.',
      });

      form.reset({ userAddress: '' });
      onOpenChange(false);
    } catch (err) {
      console.error('Add admin failed:', err);
      toast({
        title: 'Failed to add admin',
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
          <DialogTitle>Add Admin</DialogTitle>
          <DialogDescription>
            Enter the address of the user you want to grant administrator rights.
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
                  // Check if address is already an admin
                  const isAlreadyAdmin = admins.some(
                    (admin) => admin.address.toLowerCase() === trimmed.toLowerCase()
                  );
                  if (isAlreadyAdmin) {
                    return 'This address is already an admin';
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
                className="bg-strato-blue hover:bg-strato-blue/90"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding Admin...
                  </>
                ) : (
                  'Add Admin'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddAdminModal;


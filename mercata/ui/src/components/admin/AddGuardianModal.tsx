import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type AddGuardianFormValues = {
  userAddress: string;
};

interface AddGuardianModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddGuardian: (userAddress: string) => Promise<void>;
  guardians: Array<{ address: string }>;
  admins: Array<{ address: string }>;
}

const AddGuardianModal: React.FC<AddGuardianModalProps> = ({
  open,
  onOpenChange,
  onAddGuardian,
  guardians,
  admins,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<AddGuardianFormValues>({
    defaultValues: {
      userAddress: '',
    },
    mode: 'onChange',
  });

  const onSubmit = async (values: AddGuardianFormValues) => {
    const trimmedAddress = values.userAddress.trim();

    setIsSubmitting(true);
    try {
      await onAddGuardian(trimmedAddress);

      toast({
        title: 'Issue to Add Guardian Created',
        description: 'Your guardian issue has been submitted for voting.',
      });

      form.reset({ userAddress: '' });
      onOpenChange(false);
    } catch (err) {
      console.error('Add guardian failed:', err);
      toast({
        title: 'Failed to add guardian',
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
          <DialogTitle>Add Guardian</DialogTitle>
          <DialogDescription>
            Enter the address of the user you want to grant guardian rights.
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
                  const isAlreadyGuardian = guardians.some(
                    (guardian) => guardian.address.toLowerCase() === trimmed.toLowerCase()
                  );
                  if (isAlreadyGuardian) {
                    return 'This address is already a guardian';
                  }
                  const isAdmin = admins.some(
                    (admin) => admin.address.toLowerCase() === trimmed.toLowerCase()
                  );
                  if (isAdmin) {
                    return 'An admin cannot be a guardian';
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
                    Adding Guardian...
                  </>
                ) : (
                  'Add Guardian'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default AddGuardianModal;

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type RemoveGuardianFormValues = {
  userAddress: string;
};

interface RemoveGuardianModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveGuardian: (userAddress: string) => Promise<void>;
  guardians: Array<{ address: string }>;
}

const RemoveGuardianModal: React.FC<RemoveGuardianModalProps> = ({
  open,
  onOpenChange,
  onRemoveGuardian,
  guardians,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<RemoveGuardianFormValues>({
    defaultValues: {
      userAddress: '',
    },
    mode: 'onChange',
  });

  const onSubmit = async (values: RemoveGuardianFormValues) => {
    setIsSubmitting(true);
    try {
      await onRemoveGuardian(values.userAddress);

      toast({
        title: 'Issue to Remove Guardian Created',
        description: 'Your guardian issue has been submitted for voting.',
      });

      form.reset({ userAddress: '' });
      onOpenChange(false);
    } catch (err) {
      console.error('Remove guardian failed:', err);
      toast({
        title: 'Failed to remove guardian',
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
          <DialogTitle>Remove Guardian</DialogTitle>
          <DialogDescription>
            Select the guardian you want to revoke guardian rights from.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* User Address */}
            <FormField
              control={form.control}
              name="userAddress"
              rules={{
                required: 'Please select a guardian to remove',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Guardian to Remove</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="font-mono">
                        <SelectValue placeholder="Select a guardian..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {guardians.length === 0 ? (
                        <SelectItem value="no-guardians" disabled>
                          No guardians available
                        </SelectItem>
                      ) : (
                        guardians.map((guardian) => (
                          <SelectItem
                            key={guardian.address}
                            value={guardian.address}
                            className="font-mono"
                          >
                            {guardian.address}
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
                    Removing Guardian...
                  </>
                ) : (
                  'Remove Guardian'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default RemoveGuardianModal;

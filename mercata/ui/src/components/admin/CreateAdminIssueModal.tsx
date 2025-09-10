import { useForm, useFieldArray } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as React from 'react';

type CreateAdminIssueFormValues = {
  target: string;               // Contract Address (raw string in the input)
  func: string;                 // Function Name   (raw string in the input)
  args: { value: string }[];    // Dynamic list of argument strings
};

interface CreateAdminIssueModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Will be called with JSON-stringified target/func and a JSON array (string[])
  handleCastVoteOnIssue: (target: string, func: string, args: string[]) => Promise<void> | void;
}

const CreateAdminIssueModal: React.FC<CreateAdminIssueModalProps> = ({
  open,
  onOpenChange,
  handleCastVoteOnIssue,
}) => {
  const { toast } = useToast();

  const form = useForm<CreateAdminIssueFormValues>({
    defaultValues: {
      target: '',
      func: '',
      args: [{ value: '' }],
    },
    mode: 'onChange',
  });

  const {
    fields,
    append,
    remove,
  } = useFieldArray({
    control: form.control,
    name: 'args',
  });

  const onSubmit = async (values: CreateAdminIssueFormValues) => {
    // Clean up whitespace and empty args
    const trimmedTarget = values.target.trim();
    const trimmedFunc = values.func.trim();
    const argsArray = values.args
      .map(a => a.value.trim())
      .filter(v => v.length > 0);

    // Build payload with JSON-stringified target/func, and a JSON array for args
    const payload = {
      target: trimmedTarget,
      func: trimmedFunc,
      args: argsArray, // already a string[]
    };

    try {
      await handleCastVoteOnIssue(payload.target, payload.func, payload.args);

      toast({
        title: 'Issue Created',
        description: 'Your admin issue has been submitted for voting.',
      });

      form.reset({
        target: '',
        func: '',
        args: [{ value: '' }],
      });

      onOpenChange(false); // close the modal
    } catch (err) {
      // Let your global interceptor handle toasts if you prefer;
      // this is a friendly fallback.
      console.error('Create admin issue failed:', err);
      toast({
        title: 'Failed to create issue',
        description: 'Please check the inputs and try again.',
        variant: 'destructive',
      });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create Admin Issue</DialogTitle>
          <DialogDescription>
            Prepare a proposal for admins to vote on. Provide the target contract, function, and arguments.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Contract Address */}
            <FormField
              control={form.control}
              name="target"
              rules={{
                required: 'Contract address is required',
                validate: (v) =>
                  v.trim().length > 0 || 'Contract address cannot be empty',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contract Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The on-chain address of the target contract.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Function Name */}
            <FormField
              control={form.control}
              name="func"
              rules={{
                required: 'Function name is required',
                validate: (v) =>
                  v.trim().length > 0 || 'Function name cannot be empty',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Function Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="setTokenStatus"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The exact name of the function to call on the target contract.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Arguments (dynamic) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>Arguments</FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ value: '' })}
                  disabled={isSubmitting}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add argument
                </Button>
              </div>

              <div className="space-y-2">
                {fields.map((field, idx) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`args.${idx}.value`}
                    render={({ field: argField }) => (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormControl className="flex-1">
                            <Input
                              placeholder={`Argument ${idx + 1}`}
                              {...argField}
                            />
                          </FormControl>
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => remove(idx)}
                              disabled={isSubmitting}
                              className="shrink-0"
                              title="Remove argument"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        {idx === 0 && (
                          <FormDescription>
                            Enter each argument in call order. Click “Add argument” to append more.
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </div>

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
                    Submitting…
                  </>
                ) : (
                  'Create Issue'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateAdminIssueModal;

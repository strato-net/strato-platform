import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CopyButton from '@/components/ui/copy';
import { toast } from 'sonner';
import { Link2 } from 'lucide-react';
import { useCreateTrackingLink } from '@/hooks/useTracking';
import { CreateLinkInput, DEFAULT_TRACKING_DESTINATION, TRACKING_DESTINATIONS } from '@/lib/trackingApi';

interface CreateLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateLinkDialog = ({ open, onOpenChange }: CreateLinkDialogProps) => {
  const createLink = useCreateTrackingLink();
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const form = useForm<CreateLinkInput>({
    defaultValues: {
      label: '',
      source: '',
      destination: DEFAULT_TRACKING_DESTINATION,
    },
  });

  const onSubmit = async (values: CreateLinkInput) => {
    try {
      const { url } = await createLink.mutateAsync(values);
      setCreatedUrl(url);
      // Safari may reject clipboard writes after an async boundary; the
      // success state always shows the URL with a manual copy button.
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
      } catch {
        toast.success('Link created');
      }
    } catch (error) {
      form.setError('root', {
        message: error instanceof Error ? error.message : 'Failed to create link',
      });
    }
  };

  const reset = () => {
    setCreatedUrl(null);
    form.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-strato-blue" />
            New Tracking Link
          </DialogTitle>
          <DialogDescription>
            The generated URL contains only a random slug — never the label or source.
          </DialogDescription>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-4">
            <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-2">
              <span className="flex-1 break-all font-mono text-sm select-all">{createdUrl}</span>
              <CopyButton address={createdUrl} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                Create another
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="label"
                rules={{ required: 'Label is required' }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Label</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Acme Corp — Q3 outreach" {...field} />
                    </FormControl>
                    <FormDescription>Prospect, campaign, or KOL name — internal only.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="source"
                rules={{ required: 'Source is required' }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Jeff, DefiLlama, KOL Alice" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="destination"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destination</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TRACKING_DESTINATIONS.map((dest) => (
                          <SelectItem key={dest.value} value={dest.value}>
                            {dest.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
              )}
              <div className="flex justify-end">
                <Button type="submit" disabled={createLink.isPending}>
                  {createLink.isPending ? 'Generating…' : 'Generate & Copy Link'}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CreateLinkDialog;

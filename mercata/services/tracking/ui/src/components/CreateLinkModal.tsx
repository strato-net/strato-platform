import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { absoluteLinkUrl, createLink, TRACKING_DESTINATIONS } from '../api';
import { Button, CopyButton, inputClass, Modal } from './primitives';

const CreateLinkModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState<string>(TRACKING_DESTINATIONS[0].value);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createLink,
    onSuccess: async ({ url }) => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      const absolute = absoluteLinkUrl(url);
      setCreatedUrl(absolute);
      // Safari may reject clipboard writes after an async boundary; the
      // success state always shows the URL with a manual copy button.
      try {
        await navigator.clipboard.writeText(absolute);
      } catch {
        // manual copy still available
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create link'),
  });

  const reset = () => {
    setLabel('');
    setSource('');
    setDestination(TRACKING_DESTINATIONS[0].value);
    setCreatedUrl(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!label.trim() || !source.trim()) {
      setError('Label and source are required');
      return;
    }
    create.mutate({ label: label.trim(), source: source.trim(), destination });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New Tracking Link"
      description="The generated URL contains only a random slug — never the label or source."
    >
      {createdUrl ? (
        <div className="space-y-4">
          <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-2">
            <span className="flex-1 break-all font-mono text-sm select-all">{createdUrl}</span>
            <CopyButton value={createdUrl} label="Copy link" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>
              Create another
            </Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="link-label">
              Label
            </label>
            <input
              id="link-label"
              className={inputClass}
              placeholder="e.g. Acme Corp — Q3 outreach"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Prospect, campaign, or KOL name — internal only.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="link-source">
              Source
            </label>
            <input
              id="link-source"
              className={inputClass}
              placeholder="e.g. Jeff, DefiLlama, KOL Alice"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="link-destination">
              Destination
            </label>
            <select
              id="link-destination"
              className={inputClass}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              {TRACKING_DESTINATIONS.map((dest) => (
                <option key={dest.value} value={dest.value}>
                  {dest.label}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Generating…' : 'Generate & Copy Link'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default CreateLinkModal;

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isValidDestination, LinkSummary, updateLink } from '../api';
import DestinationField, { isPresetDestination } from './DestinationField';
import { Button, inputClass, Modal } from './primitives';

// Edit label, source, full source, and destination of an existing link. The
// slug is immutable — already-shared URLs keep working across edits.
const EditLinkModal = ({ link, onClose }: { link: LinkSummary | null; onClose: () => void }) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [fullSource, setFullSource] = useState('');
  const [destination, setDestination] = useState('');
  const [customDestination, setCustomDestination] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    setLabel(link.label);
    setSource(link.source);
    setFullSource(link.fullSource);
    setDestination(link.destination);
    setCustomDestination(!isPresetDestination(link.destination));
    setError(null);
  }, [link]);

  const save = useMutation({
    mutationFn: (fields: Parameters<typeof updateLink>[1]) => updateLink(link!.id, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save changes'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    if (!isValidDestination(destination.trim())) {
      setError('Destination must be a relative path (/…) or an absolute http(s) URL');
      return;
    }
    save.mutate({
      label: label.trim(),
      source: source.trim(),
      fullSource: fullSource.trim(),
      destination: destination.trim(),
    });
  };

  return (
    <Modal
      open={!!link}
      onClose={onClose}
      title="Edit Tracking Link"
      description={link ? `/t/${link.slug} — the URL itself never changes.` : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="edit-link-label">
            Label
          </label>
          <input
            id="edit-link-label"
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="edit-link-source">
            Source
          </label>
          <input
            id="edit-link-source"
            className={inputClass}
            placeholder="e.g. LinkedIn, X, website"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="edit-link-full-source">
            Full source
          </label>
          <input
            id="edit-link-full-source"
            className={inputClass}
            placeholder="e.g. LinkedIn — Jeff's launch post"
            value={fullSource}
            onChange={(e) => setFullSource(e.target.value)}
          />
        </div>
        <DestinationField
          destination={destination}
          onDestinationChange={setDestination}
          customMode={customDestination}
          onCustomModeChange={(custom) => {
            setCustomDestination(custom);
            if (custom && isPresetDestination(destination)) setDestination('');
          }}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default EditLinkModal;

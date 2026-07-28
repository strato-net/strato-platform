import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateLink } from '../api';
import { Button, inputClass, Modal } from './primitives';

interface EditLinkModalProps {
  link: { id: string; label: string; source: string } | null;
  onClose: () => void;
}

// Slug and destination are immutable — a shared URL must keep meaning the same
// thing. Only the internal label/source annotations are editable.
const EditLinkModal = ({ link, onClose }: EditLinkModalProps) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (link) {
      setLabel(link.label);
      setSource(link.source);
      setError(null);
    }
  }, [link]);

  const save = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: { label: string; source: string } }) =>
      updateLink(id, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['links'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save changes'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!link) return;
    if (!label.trim() || !source.trim()) {
      setError('Label and source are required');
      return;
    }
    save.mutate({ id: link.id, fields: { label: label.trim(), source: source.trim() } });
  };

  return (
    <Modal
      open={link !== null}
      onClose={onClose}
      title="Edit Tracking Link"
      description="The link URL and destination stay the same — only the internal label and source change."
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
          <p className="mt-1 text-xs text-muted-foreground">
            Prospect, campaign, or KOL name — internal only.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="edit-link-source">
            Source
          </label>
          <input
            id="edit-link-source"
            className={inputClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default EditLinkModal;

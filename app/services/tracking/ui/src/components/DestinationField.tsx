import { TRACKING_DESTINATIONS } from '../api';
import { inputClass } from './primitives';

const CUSTOM = '__custom__';

// Destination picker: the common app pages as presets, plus a "Custom URL"
// escape hatch accepting any relative path or absolute http(s) URL. The
// parent owns both the value and the mode so modals can reset/prefill.
const DestinationField = ({
  destination,
  onDestinationChange,
  customMode,
  onCustomModeChange,
}: {
  destination: string;
  onDestinationChange: (next: string) => void;
  customMode: boolean;
  onCustomModeChange: (next: boolean) => void;
}) => (
  <div>
    <label className="mb-1 block text-sm font-medium" htmlFor="link-destination">
      Destination
    </label>
    <select
      id="link-destination"
      className={inputClass}
      value={customMode ? CUSTOM : destination}
      onChange={(e) => {
        if (e.target.value === CUSTOM) {
          onCustomModeChange(true);
        } else {
          onCustomModeChange(false);
          onDestinationChange(e.target.value);
        }
      }}
    >
      {TRACKING_DESTINATIONS.map((dest) => (
        <option key={dest.value} value={dest.value}>
          {dest.label}
        </option>
      ))}
      <option value={CUSTOM}>Custom URL…</option>
    </select>
    {customMode && (
      <>
        <input
          id="link-destination-custom"
          className={`${inputClass} mt-2`}
          placeholder="/dashboard/earn or https://example.com/page"
          value={destination}
          onChange={(e) => onDestinationChange(e.target.value)}
          autoFocus
        />
        <p className="mt-1 text-xs text-muted-foreground">
          A path on the app host (/…) or a full http(s) URL.
        </p>
      </>
    )}
  </div>
);

// Whether a stored destination matches one of the presets (edit prefill).
export const isPresetDestination = (destination: string) =>
  TRACKING_DESTINATIONS.some((dest) => dest.value === destination);

export default DestinationField;

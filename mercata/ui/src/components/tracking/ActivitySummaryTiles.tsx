import {
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_ORDER,
  TrackingActivitySummary,
} from '@/lib/trackingApi';

// Stat tiles for per-category activity counts; zero categories are dropped so
// the grid stays scannable.
const ActivitySummaryTiles = ({ summary }: { summary: TrackingActivitySummary }) => {
  const entries = ACTIVITY_CATEGORY_ORDER.filter((category) => (summary[category] ?? 0) > 0);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No on-chain activity yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {entries.map((category) => (
        <div key={category} className="rounded-lg border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {ACTIVITY_CATEGORY_LABELS[category]}
          </div>
          <div className="mt-1 text-lg font-semibold">{summary[category]}</div>
        </div>
      ))}
    </div>
  );
};

export default ActivitySummaryTiles;

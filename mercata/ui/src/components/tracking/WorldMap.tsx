import { useEffect, useState } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import { Skeleton } from '@/components/ui/skeleton';
import { TrackingGeoPoint } from '@/lib/trackingApi';

interface TooltipState {
  x: number;
  y: number;
  label: string;
}

// Visitor-location dot map. Single series (visitor opens), so identity never
// rides on color alone: one primary-colored mark with a surface ring, count in
// the tooltip. Land/ink colors come from theme tokens so dark mode is a real
// palette, not an inverted one.
const WorldMap = ({ points }: { points: TrackingGeoPoint[] }) => {
  const [land, setLand] = useState<object | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Lazy-load the ~200KB topojson so it stays out of the main bundle
    import('world-atlas/land-110m.json').then((mod) => {
      if (!cancelled) setLand(mod.default ?? mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!land) {
    return <Skeleton className="h-64 w-full" />;
  }

  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const radiusFor = (count: number) => 4 + (Math.sqrt(count) / Math.sqrt(maxCount)) * 6;

  return (
    <div className="relative">
      <ComposableMap
        projection="geoEqualEarth"
        projectionConfig={{ scale: 150 }}
        style={{ width: '100%', height: 'auto' }}
        aria-label="World map of visitor locations"
      >
        <Geographies geography={land}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: {
                    fill: 'hsl(var(--muted))',
                    stroke: 'hsl(var(--border))',
                    strokeWidth: 0.5,
                    outline: 'none',
                  },
                  hover: {
                    fill: 'hsl(var(--muted))',
                    outline: 'none',
                  },
                  pressed: {
                    fill: 'hsl(var(--muted))',
                    outline: 'none',
                  },
                }}
              />
            ))
          }
        </Geographies>
        {points.map((point, i) => (
          <Marker key={i} coordinates={[point.lon, point.lat]}>
            {/* Oversized transparent halo keeps the hit target ≥ 8px */}
            <circle
              r={radiusFor(point.count) + 6}
              fill="transparent"
              onMouseEnter={(e) => {
                const svg = (e.target as SVGElement).closest('svg');
                const rect = svg?.getBoundingClientRect();
                setTooltip({
                  x: e.clientX - (rect?.left ?? 0),
                  y: e.clientY - (rect?.top ?? 0),
                  label: `${[point.city, point.country].filter(Boolean).join(', ') || 'Unknown location'} — ${point.count} ${point.count === 1 ? 'open' : 'opens'}`,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
            <circle
              r={radiusFor(point.count)}
              fill="hsl(var(--primary))"
              fillOpacity={0.85}
              stroke="hsl(var(--background))"
              strokeWidth={2}
              pointerEvents="none"
            />
          </Marker>
        ))}
      </ComposableMap>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
};

export default WorldMap;

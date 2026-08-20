import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps';
import { format } from 'date-fns';
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { GeoPoint, GeoVisit, shortAddress, userTimelinePath } from '../api';
import { Button, IconButton, RangeSlider, Skeleton } from './primitives';

interface TooltipState {
  x: number;
  y: number;
  label: string;
}

interface Visitor {
  address: string;
  lastAt: string;
}

interface PopoverState {
  x: number;
  y: number;
  title: string;
  visitors: Visitor[];
  visitorCount: number;
  anonymous: number;
}

// One point with only the visits inside the selected time range
interface VisiblePoint {
  point: GeoPoint;
  visits: GeoVisit[];
}

const HOME_CENTER: [number, number] = [0, 20];
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const ZOOM_FACTOR = 1.6;
// A pointer that moved further than this between down and up was a pan, not
// a click on a dot
const DRAG_SLOP_PX = 4;
const MAX_POPOVER_VISITORS = 8;

const labelOf = (point: GeoPoint): string =>
  [point.city, point.country].filter(Boolean).join(', ') || 'Unknown location';

const opens = (count: number): string => `${count} ${count === 1 ? 'open' : 'opens'}`;

// Distinct visitors (newest visit first) plus the anonymous remainder
const visitorsOf = (visits: GeoVisit[]): { visitors: Visitor[]; anonymous: number } => {
  const visitors: Visitor[] = [];
  const seen = new Set<string>();
  let anonymous = 0;
  for (const visit of visits) {
    if (!visit.address) {
      anonymous += 1;
      continue;
    }
    if (seen.has(visit.address)) continue;
    seen.add(visit.address);
    visitors.push({ address: visit.address, lastAt: visit.at });
  }
  return { visitors, anonymous };
};

// Visitor-location dot map. Single series (visitor opens), so identity never
// rides on color alone: one primary-colored mark with a surface ring, count in
// the tooltip. Land/ink colors come from theme tokens so dark mode is a real
// palette, not an inverted one. The map pans/zooms, the slider narrows the
// time window, and a dot leads to its visitor's activity timeline.
const WorldMap = ({ points, truncated = false }: { points: GeoPoint[]; truncated?: boolean }) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const [land, setLand] = useState<object | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [view, setView] = useState<{ center: [number, number]; zoom: number }>({
    center: HOME_CENTER,
    zoom: 1,
  });

  const bounds = useMemo<[number, number]>(() => {
    const times = points
      .flatMap((point) => point.visits.map((visit) => Date.parse(visit.at)))
      .filter((ms) => Number.isFinite(ms));
    if (times.length === 0) return [0, 0];
    return [Math.min(...times), Math.max(...times)];
  }, [points]);

  const [range, setRange] = useState<[number, number]>(bounds);
  // A new payload (refetch, other link) resets the window to its full span
  useEffect(() => setRange(bounds), [bounds]);

  useEffect(() => {
    let cancelled = false;
    // Lazy-load the ~200KB topojson so it stays out of the main bundle
    import('world-atlas/land-110m.json').then((mod) => {
      if (!cancelled) setLand((mod as { default?: object }).default ?? mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!popover) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !containerRef.current?.contains(target)) setPopover(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [popover]);

  const visible = useMemo<VisiblePoint[]>(
    () =>
      points
        .map((point) => ({
          point,
          visits: point.visits.filter((visit) => {
            const ms = Date.parse(visit.at);
            return ms >= range[0] && ms <= range[1];
          }),
        }))
        .filter((entry) => entry.visits.length > 0),
    [points, range]
  );

  if (!land) {
    return <Skeleton className="h-64 w-full" />;
  }

  const visibleOpens = visible.reduce((total, entry) => total + entry.visits.length, 0);
  const maxCount = Math.max(1, ...visible.map((entry) => entry.visits.length));
  const radiusFor = (count: number) => 4 + (Math.sqrt(count) / Math.sqrt(maxCount)) * 6;

  const zoomBy = (factor: number) => {
    setTooltip(null);
    setPopover(null);
    setView((current) => ({
      ...current,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor)),
    }));
  };

  // One visitor behind the dot: straight to their timeline. Zero or several:
  // a popover listing who they are.
  const activate = (entry: VisiblePoint, target: SVGElement) => {
    const { visitors, anonymous } = visitorsOf(entry.visits);
    if (visitors.length === 1) {
      navigate(userTimelinePath(visitors[0].address));
      return;
    }
    const container = containerRef.current?.getBoundingClientRect();
    const dot = target.getBoundingClientRect();
    setTooltip(null);
    setPopover({
      x: dot.left + dot.width / 2 - (container?.left ?? 0),
      y: dot.top - (container?.top ?? 0),
      title: `${labelOf(entry.point)} — ${opens(entry.visits.length)}`,
      visitors: visitors.slice(0, MAX_POPOVER_VISITORS),
      visitorCount: visitors.length,
      anonymous,
    });
  };

  const rangeDisabled = bounds[0] === bounds[1];
  const rangeIsFull = range[0] === bounds[0] && range[1] === bounds[1];

  return (
    <div className="space-y-3">
      <div className="relative" ref={containerRef}>
        <ComposableMap
          projection="geoEqualEarth"
          projectionConfig={{ scale: 150 }}
          style={{ width: '100%', height: 'auto' }}
          aria-label="World map of visitor locations"
        >
          <ZoomableGroup
            center={view.center}
            zoom={view.zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onMoveStart={() => {
              setTooltip(null);
              setPopover(null);
            }}
            onMoveEnd={({ coordinates, zoom }) => setView({ center: coordinates, zoom })}
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
                        strokeWidth: 0.5 / view.zoom,
                        outline: 'none',
                      },
                      hover: { fill: 'hsl(var(--muted))', outline: 'none' },
                      pressed: { fill: 'hsl(var(--muted))', outline: 'none' },
                    }}
                  />
                ))
              }
            </Geographies>
            {visible.map((entry, i) => {
              const count = entry.visits.length;
              const radius = radiusFor(count) / view.zoom;
              return (
                <Marker key={i} coordinates={[entry.point.lon, entry.point.lat]}>
                  {/* Oversized transparent halo keeps the hit target ≥ 8px */}
                  <circle
                    r={radius + 6 / view.zoom}
                    fill="transparent"
                    role="button"
                    tabIndex={0}
                    aria-label={`${labelOf(entry.point)} — ${opens(count)}, view visitors`}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    onMouseEnter={(e) => {
                      if (popover) return;
                      const rect = containerRef.current?.getBoundingClientRect();
                      setTooltip({
                        x: e.clientX - (rect?.left ?? 0),
                        y: e.clientY - (rect?.top ?? 0),
                        label: `${labelOf(entry.point)} — ${opens(count)}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onPointerDown={(e) => {
                      pointerDownAt.current = { x: e.clientX, y: e.clientY };
                    }}
                    onClick={(e) => {
                      // A click that ends a pan must not navigate
                      const down = pointerDownAt.current;
                      pointerDownAt.current = null;
                      if (
                        down &&
                        Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_SLOP_PX
                      ) {
                        return;
                      }
                      activate(entry, e.currentTarget as SVGElement);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      activate(entry, e.currentTarget as SVGElement);
                    }}
                  />
                  <circle
                    r={radius}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.85}
                    stroke="hsl(var(--background))"
                    strokeWidth={2 / view.zoom}
                    pointerEvents="none"
                  />
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <IconButton
            label="Zoom in"
            onClick={() => zoomBy(ZOOM_FACTOR)}
            disabled={view.zoom >= MAX_ZOOM}
          >
            <ZoomIn size={14} />
          </IconButton>
          <IconButton
            label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_FACTOR)}
            disabled={view.zoom <= MIN_ZOOM}
          >
            <ZoomOut size={14} />
          </IconButton>
          <IconButton
            label="Reset view"
            onClick={() => {
              setTooltip(null);
              setPopover(null);
              setView({ center: HOME_CENTER, zoom: 1 });
            }}
          >
            <Maximize2 size={14} />
          </IconButton>
        </div>

        {tooltip && !popover && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{ left: tooltip.x, top: tooltip.y - 8 }}
          >
            {tooltip.label}
          </div>
        )}

        {popover && (
          <div
            className="absolute z-20 w-64 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
            style={{ left: popover.x, top: popover.y - 8 }}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="font-medium">{popover.title}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPopover(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
            {popover.visitors.length === 0 ? (
              <p className="text-muted-foreground">
                No wallet connected from here — nothing to link to.
              </p>
            ) : (
              <ul className="space-y-1">
                {popover.visitors.map((visitor) => (
                  <li key={visitor.address} className="flex items-center justify-between gap-2">
                    <Link
                      to={userTimelinePath(visitor.address)}
                      className="font-mono hover:underline"
                      title="View activity timeline"
                    >
                      {shortAddress(visitor.address)}
                    </Link>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {format(new Date(visitor.lastAt), 'MMM d, HH:mm')}
                    </span>
                  </li>
                ))}
                {popover.visitorCount > popover.visitors.length && (
                  <li className="text-muted-foreground">
                    +{popover.visitorCount - popover.visitors.length} more visitors
                  </li>
                )}
              </ul>
            )}
            {popover.anonymous > 0 && (
              <p className="mt-1 text-muted-foreground">
                {popover.anonymous} anonymous {popover.anonymous === 1 ? 'open' : 'opens'}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {rangeDisabled
              ? format(new Date(bounds[1] || Date.now()), 'MMM d, yyyy')
              : `${format(new Date(range[0]), 'MMM d, yyyy')} — ${format(new Date(range[1]), 'MMM d, yyyy')}`}
          </span>
          <span className="flex items-center gap-2">
            <span>{opens(visibleOpens)} in range</span>
            <Button
              variant="outline"
              onClick={() => setRange(bounds)}
              disabled={rangeDisabled || rangeIsFull}
            >
              Reset range
            </Button>
          </span>
        </div>
        <RangeSlider
          min={bounds[0]}
          max={bounds[1]}
          value={range}
          onChange={setRange}
          disabled={rangeDisabled}
          labelStart={format(new Date(range[0] || Date.now()), 'MMM d, yyyy HH:mm')}
          labelEnd={format(new Date(range[1] || Date.now()), 'MMM d, yyyy HH:mm')}
        />
        {truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the most recent 5,000 opens.
          </p>
        )}
      </div>
    </div>
  );
};

export default WorldMap;

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SimulatedEvent, SimulationResult, TraceFrame } from "@/services/simulation";

interface SimulationResultPanelProps {
  result: SimulationResult | null;
  error?: string;
  /** Optional heading, e.g. "Proposal tx" vs "Effect if executed". */
  title?: string;
}

/**
 * Inline dry-run result: status/gas/return value/events, plus a
 * collapsed-by-default execution trace tree.
 */
export function SimulationResultPanel({ result, error, title }: SimulationResultPanelProps) {
  const [showTrace, setShowTrace] = useState(false);

  if (!result && !error) return null;

  const failed = !!error || result?.status !== "Success";
  const message = error || result?.error || "";
  const returned = result?.data?.contents ?? result?.response;
  const traceRoots: TraceFrame[] = !result?.trace
    ? []
    : Array.isArray(result.trace)
      ? result.trace
      : [result.trace];

  const panel = (
    <div
      className={
        failed
          ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          : "rounded-md border border-emerald-600/40 bg-emerald-500/10 p-3 text-sm"
      }
    >
      <div className="font-medium">
        {title ? `${title}: ` : "Simulation: "}
        {failed ? "transaction would fail" : "transaction would succeed"}
      </div>

      {message ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs text-destructive">
          {message}
        </pre>
      ) : null}

      {result ? (
        <div className="mt-1 text-xs text-muted-foreground">Gas used: {result.gasUsed}</div>
      ) : null}

      {returned != null ? (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(returned, null, 2)}
        </pre>
      ) : null}

      {result?.events?.length ? (
        <div className="mt-2 space-y-0.5">
          {result.events.map((ev, i) => (
            <EventLine key={i} event={ev} />
          ))}
        </div>
      ) : null}

      {traceRoots.length ? (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setShowTrace((s) => !s)}
          >
            {showTrace ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Execution trace
          </button>
          {showTrace ? (
            <div className="mt-1 max-h-64 overflow-auto">
              {traceRoots.map((frame, i) => (
                <TraceFrameView key={i} frame={frame} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  // A castVoteOnIssue simulation carries the issue's effect; show it as a
  // second panel so the voter sees both the vote tx and what it would execute.
  if (!result?.effect) return panel;
  return (
    <div className="space-y-2">
      {panel}
      <SimulationResultPanel result={result.effect} title="Effect if executed" />
    </div>
  );
}

function EventLine({ event }: { event: SimulatedEvent }) {
  const argText = Object.entries(event.args ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return (
    <div className="break-all font-mono text-xs text-muted-foreground">
      {event.name}({argText}) @ {event.address}
    </div>
  );
}

function TraceFrameView({ frame }: { frame: TraceFrame }) {
  return (
    <div className="pl-3 border-l border-border">
      <div className="break-all font-mono text-xs">
        <span className="text-muted-foreground">{frame.type} </span>
        {frame.contract}.{frame.function}({(frame.args ?? []).join(", ")})
        <span className="text-muted-foreground"> gas={frame.gasUsed}</span>
        {frame.output != null ? <span className="text-muted-foreground"> → {frame.output}</span> : null}
        {frame.error ? <span className="text-destructive"> ✗ {frame.error}</span> : null}
      </div>
      {(frame.logs ?? []).map((ev, i) => (
        <div key={`log-${i}`} className="pl-3">
          <div className="break-all font-mono text-xs text-muted-foreground">
            emit {ev.name}({Object.entries(ev.args ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ")})
          </div>
        </div>
      ))}
      {(frame.calls ?? []).map((child, i) => (
        <TraceFrameView key={`call-${i}`} frame={child} />
      ))}
    </div>
  );
}

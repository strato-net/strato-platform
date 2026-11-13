import { useSyncExternalStore } from "react";
import { AlignJustify, ArrowDownFromLine, ArrowUpFromLine, Minus, Ruler, Slash, Trash2 } from "lucide-react";
import { DrawingStore } from "@/components/terminal/DrawingLayer";

const TOOLS = [
  { tool: "trend", label: "Trend line", Icon: Slash },
  { tool: "horizontal", label: "Horizontal line", Icon: Minus },
  { tool: "fib", label: "Fibonacci retracement", Icon: AlignJustify },
  { tool: "measure", label: "Measure", Icon: Ruler },
  { tool: "long", label: "Long position", Icon: ArrowUpFromLine },
  { tool: "short", label: "Short position", Icon: ArrowDownFromLine },
] as const;

/** The chart's drawing tools: pick one, then click on the chart */
export const DrawingTools = ({ store }: { store: DrawingStore }) => {
  useSyncExternalStore(store.subscribe, () => store.version);
  const removeLabel = store.selected === null ? "Remove all drawings" : "Remove drawing";

  return (
    <div className="flex flex-col items-center gap-1 border-r border-border px-1 py-1">
      {TOOLS.map(({ tool, label, Icon }) => (
        <button
          key={tool}
          onClick={() => store.arm(store.tool === tool ? null : tool)}
          aria-label={label}
          aria-pressed={store.tool === tool}
          title={label}
          className={`rounded p-1 ${
            store.tool === tool ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <div className="h-px w-full bg-border" />
      <button
        onClick={() => store.remove()}
        disabled={store.drawings.length === 0}
        aria-label={removeLabel}
        title={removeLabel}
        className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

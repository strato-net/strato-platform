import { useState } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
  Circle,
  Columns2,
  GitBranch,
  LucideIcon,
  Minus,
  MousePointer2,
  MoveHorizontal,
  MoveRight,
  ScanLine,
  Square,
  TrendingUp,
  Type,
  X,
} from "lucide-react";
import { DrawingTool } from "@/components/terminal/drawings";
import { DrawingStore } from "@/components/terminal/DrawingLayer";
import { INDICATORS } from "@/components/terminal/indicators";

/** null is the crosshair: no tool in hand */
const GROUPS: { title: string; items: { tool: DrawingTool | null; name: string; Icon: LucideIcon }[] }[] = [
  {
    title: "Lines",
    items: [
      { tool: null, name: "Crosshair / Pan", Icon: MousePointer2 },
      { tool: "trend", name: "Trend Line", Icon: TrendingUp },
      { tool: "horizontal", name: "Horizontal Level", Icon: Minus },
      { tool: "vertical", name: "Vertical Line", Icon: Columns2 },
      { tool: "ray", name: "Ray", Icon: MoveRight },
      { tool: "extended", name: "Extended Line", Icon: MoveHorizontal },
      { tool: "arrow", name: "Arrow", Icon: ArrowUpRight },
    ],
  },
  {
    title: "Analysis",
    items: [
      { tool: "fib", name: "Fibonacci Retracement", Icon: GitBranch },
      { tool: "channel", name: "Parallel Channel", Icon: ScanLine },
      { tool: "measure", name: "Price & Time Range", Icon: ArrowUpDown },
      { tool: "long", name: "Long Position", Icon: ArrowUpRight },
      { tool: "short", name: "Short Position", Icon: ArrowUpDown },
    ],
  },
  {
    title: "Annotations",
    items: [
      { tool: "rectangle", name: "Rectangle", Icon: Square },
      { tool: "ellipse", name: "Ellipse", Icon: Circle },
      { tool: "text", name: "Text Note", Icon: Type },
    ],
  },
];

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section>
    <h3 className="mb-2 font-sans text-[10px] font-medium uppercase leading-none tracking-[1px] text-muted-foreground">
      {title}
    </h3>
    {children}
  </section>
);

interface OptionProps {
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const Option = ({ Icon, active, onClick, children }: OptionProps) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`flex w-full items-center gap-[7px] rounded px-[5px] py-2 text-left text-[11px] leading-[15px] ${
      active ? "bg-muted text-drawing" : "text-foreground/70 hover:bg-muted/60"
    }`}
  >
    <Icon className="h-[15px] w-[15px] shrink-0" />
    <span className="min-w-0">{children}</span>
    {active && <Check className="ml-auto h-3 w-3 shrink-0" />}
  </button>
);

interface ChartToolsProps {
  store: DrawingStore;
  indicators: string[];
  onIndicator: (id: string) => void;
  onClose: () => void;
}

/** The chart's drawing tools and indicators, laid over the chart while it is open */
export const ChartTools = ({ store, indicators, onIndicator, onClose }: ChartToolsProps) => (
  <div className="absolute inset-x-0 top-0 z-20 max-h-full overflow-auto border-b border-drawing/50 bg-background p-5 shadow-[0_20px_40px_rgba(0,0,0,0.33)]">
    <div className="mb-[15px] flex items-center justify-between">
      <b className="text-[13px] font-semibold">Chart Tools</b>
      <button
        onClick={onClose}
        aria-label="Close Chart Tools"
        title="Close Chart Tools"
        className="rounded p-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    {/* three columns where they fit, never more */}
    <div className="grid gap-[15px] [grid-template-columns:repeat(auto-fit,minmax(max(150px,30%),1fr))]">
      {GROUPS.map(({ title, items }) => (
        <Group key={title} title={title}>
          {items.map(({ tool, name, Icon }) => (
            <Option
              key={name}
              Icon={Icon}
              active={store.tool === tool}
              onClick={() => {
                store.arm(tool);
                onClose();
              }}
            >
              {name}
            </Option>
          ))}
        </Group>
      ))}
      <Group title="Indicators">
        {INDICATORS.map(({ id, label }) => (
          <Option key={id} Icon={ScanLine} active={indicators.includes(id)} onClick={() => onIndicator(id)}>
            {label}
          </Option>
        ))}
      </Group>
    </div>
    <p className="mt-[15px] border-t border-border pt-[13px] text-[10px] leading-[1.7] text-muted-foreground">
      Drag on the chart to draw. Drag the bottom axis to change candle spacing.
    </p>
  </div>
);

/** Where the words of a text note are typed, once its place on the chart is picked */
export const NoteEditor = ({ store }: { store: DrawingStore }) => {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        store.endNote(text.trim());
      }}
      className="absolute left-5 right-5 top-10 z-20 flex items-center gap-2.5 rounded-md border border-border bg-muted p-3 shadow-[0_10px_30px_rgba(0,0,0,0.33)]"
    >
      <input
        autoFocus
        aria-label="Chart Note"
        maxLength={100}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Add your note…"
        className="min-w-0 flex-1 bg-transparent py-[7px] text-xs outline-none placeholder:text-muted-foreground"
      />
      <button type="submit" className="whitespace-nowrap text-xs text-drawing">
        Add Note
      </button>
      <button
        type="button"
        onClick={() => store.endNote()}
        aria-label="Cancel Note"
        title="Cancel Note"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
};

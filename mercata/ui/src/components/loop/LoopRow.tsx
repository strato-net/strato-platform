import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const InfoTip = ({ text }: { text: string }) => (
  <TooltipProvider delayDuration={200}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info size={13} className="inline-block text-muted-foreground/60 cursor-help ml-1 shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const Row = ({
  label,
  value,
  valueClass,
  tip,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClass?: string;
  tip?: string;
}) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground flex items-center">
      {label}
      {tip && <InfoTip text={tip} />}
    </span>
    <span className={`font-medium tabular-nums ${valueClass ?? ""}`.trim()}>
      {value}
    </span>
  </div>
);

export const ExpandableRow = ({
  label,
  summary,
  open,
  onOpenChange,
  children,
  tip,
}: {
  label: ReactNode;
  summary: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  tip?: string;
}) => (
  <Collapsible open={open} onOpenChange={onOpenChange}>
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground flex items-center">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 font-medium tabular-nums"
        >
          {summary}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </CollapsibleTrigger>
    </div>
    <CollapsibleContent>
      <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm space-y-2">
        {children}
      </div>
    </CollapsibleContent>
  </Collapsible>
);

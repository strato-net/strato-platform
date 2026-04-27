import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const TABS = ["overview", "position"] as const;
export type LoopDetailTab = (typeof TABS)[number];

interface LoopHeaderProps {
  assetSymbol: string;
  activeTab: LoopDetailTab;
  onTabChange: (tab: LoopDetailTab) => void;
  onBack: () => void;
}

const LoopHeader = ({ assetSymbol, activeTab, onTabChange, onBack }: LoopHeaderProps) => (
  <div className="grid grid-cols-1 xl:grid-cols-[0.7fr_1.3fr] gap-6 items-end border-b border-border">
    <div className="flex items-center gap-3 pb-2">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8 shrink-0"
        onClick={onBack}
      >
        <ArrowLeft size={14} />
      </Button>
      <h2 className="text-xl font-semibold">
        {assetSymbol || "Asset"} CDP Loop
      </h2>
    </div>
    <div className="flex gap-6 -mb-px">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onTabChange(tab)}
          className={`pb-2 text-xl font-semibold transition-colors ${
            activeTab === tab
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab === "overview" ? "Overview" : "Your Position"}
        </button>
      ))}
    </div>
  </div>
);

export default LoopHeader;

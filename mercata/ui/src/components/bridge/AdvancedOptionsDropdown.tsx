import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import NetworkSelector from "./NetworkSelector";
import { NetworkSummary } from "@/lib/bridge/types";

interface AdvancedOptionsDropdownProps {
  selectedNetwork: string | null;
  availableNetworks: NetworkSummary[];
  onNetworkChange: (networkName: string) => void;
  direction?: "in" | "out";
  disabled?: boolean;
}

const AdvancedOptionsDropdown: React.FC<AdvancedOptionsDropdownProps> = ({
  selectedNetwork,
  availableNetworks,
  onNetworkChange,
  direction = "out",
  disabled = false,
}) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  return (
    <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={`w-full flex items-center justify-between bg-transparent hover:bg-accent ${
            isAdvancedOpen ? "border border-b-0 border-border rounded-b-none" : "border-0"
          }`}
        >
          <span>See Advanced Options</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              isAdvancedOpen ? "rotate-180" : ""
            }`}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="bg-card border border-t-0 border-border rounded-t-none rounded-lg shadow-lg p-4 space-y-4">
        <NetworkSelector
          selectedNetwork={selectedNetwork}
          availableNetworks={availableNetworks}
          onNetworkChange={onNetworkChange}
          direction={direction}
          disabled={disabled}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};

export default AdvancedOptionsDropdown;


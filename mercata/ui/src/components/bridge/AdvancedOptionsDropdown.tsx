import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors" disabled={disabled}>
        <span>See Advanced Options</span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4 space-y-4">
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

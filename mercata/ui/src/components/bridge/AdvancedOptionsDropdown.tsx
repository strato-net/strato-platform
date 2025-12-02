import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const advancedOptionsRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAdvancedOpen || !advancedOptionsRef.current || !dropdownRef.current) {
      return;
    }

    const updatePosition = () => {
      if (advancedOptionsRef.current && dropdownRef.current) {
        const rect = advancedOptionsRef.current.getBoundingClientRect();
        dropdownRef.current.style.top = `${rect.bottom - 1}px`;
        dropdownRef.current.style.left = `${rect.left}px`;
        dropdownRef.current.style.width = `${rect.width}px`;
      }
    };

    const handleScroll = () => {
      setIsAdvancedOpen(false);
    };

    const handleWheel = (e: WheelEvent) => {
      if (dropdownRef.current && dropdownRef.current.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        setIsAdvancedOpen(false);
      }
    };

    updatePosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
    };
  }, [isAdvancedOpen]);

  return (
    <div className="relative" ref={advancedOptionsRef}>
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={`w-full flex items-center justify-between bg-transparent hover:bg-gray-100 ${
              isAdvancedOpen ? "border border-b-0 border-gray-200 rounded-b-none" : "border-0"
            }`}
            disabled={disabled}
          >
            <span>See Advanced Options</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${
                isAdvancedOpen ? "rotate-180" : ""
              }`}
            />
          </Button>
        </CollapsibleTrigger>
      </Collapsible>
      {isAdvancedOpen && (
        <div
          ref={dropdownRef}
          className="fixed bg-white border border-t-0 border-gray-200 rounded-t-none rounded-lg shadow-lg p-4 space-y-4 z-50"
          style={{
            top: advancedOptionsRef.current ? `${advancedOptionsRef.current.getBoundingClientRect().bottom - 1}px` : '0',
            left: advancedOptionsRef.current ? `${advancedOptionsRef.current.getBoundingClientRect().left}px` : '0',
            width: advancedOptionsRef.current ? `${advancedOptionsRef.current.getBoundingClientRect().width}px` : 'auto',
            overflow: 'hidden',
            overscrollBehavior: 'none',
            touchAction: 'none',
          }}
        >
          <NetworkSelector
            selectedNetwork={selectedNetwork}
            availableNetworks={availableNetworks}
            onNetworkChange={onNetworkChange}
            direction={direction}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};

export default AdvancedOptionsDropdown;


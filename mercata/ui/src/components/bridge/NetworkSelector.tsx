import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NetworkSummary } from "@/lib/bridge/types";

interface NetworkSelectorProps {
  selectedNetwork: string | null;
  availableNetworks: NetworkSummary[];
  onNetworkChange: (networkName: string) => void;
  direction?: "in" | "out";
  disabled?: boolean;
}

const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  selectedNetwork,
  availableNetworks,
  onNetworkChange,
  direction = "out",
  disabled = false,
}) => {
  const isBridgeIn = direction === "in";

  const NetworkSelect = ({ id }: { id: string }) => (
    <Select value={selectedNetwork || ""} onValueChange={onNetworkChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Select network" />
      </SelectTrigger>
      <SelectContent>
        {availableNetworks.map((n) => (
          <SelectItem key={n.chainId} value={n.chainName}>
            {n.chainName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const StratoInput = ({ id }: { id: string }) => (
    <Input id={id} value="STRATO" disabled className="bg-muted" />
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="from-network">From Network</Label>
        {isBridgeIn ? <NetworkSelect id="from-network" /> : <StratoInput id="from-network" />}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="to-network">To Network</Label>
        {isBridgeIn ? <StratoInput id="to-network" /> : <NetworkSelect id="to-network" />}
      </div>
    </div>
  );
};

export default NetworkSelector;

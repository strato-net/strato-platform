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
}

const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  selectedNetwork,
  availableNetworks,
  onNetworkChange,
}) => {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="from-chain">From Network</Label>
        <Input
          id="from-chain"
          value="STRATO"
          disabled
          className="bg-gray-50"
        />
      </div>

      <div className="flex-1 space-y-1.5">
        <Label htmlFor="to-network">To Network</Label>
        <Select
          value={selectedNetwork || ""}
          onValueChange={onNetworkChange}
        >
          <SelectTrigger id="to-network">
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
      </div>
    </div>
  );
};

export default NetworkSelector;


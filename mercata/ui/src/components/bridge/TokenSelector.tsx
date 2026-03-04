import React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BridgeToken } from "@mercata/shared-types";

interface TokenSelectorProps {
  selectedToken: BridgeToken | null;
  tokens: BridgeToken[];
  onTokenChange: (token: BridgeToken | null) => void;
  disabled?: boolean;
  direction?: "in" | "out";
}

const TokenSelector: React.FC<TokenSelectorProps> = ({
  selectedToken,
  tokens,
  onTokenChange,
  disabled = false,
  direction = "in",
}) => {
  const tokenLabel = (token: BridgeToken | null): string => {
    if (!token) return "Select asset";
    const external = token.externalSymbol || token.externalName;
    const strato = token.stratoTokenSymbol || token.stratoTokenName;
    const source = direction === "out" ? strato : external;
    const target = direction === "out" ? external : strato;
    if (!source) return target || "Select asset";
    return target ? `${source} -> ${target}` : source;
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="from-token">Select asset</Label>
      <Select
        value={selectedToken?.id || ""}
        onValueChange={(v) => {
          const token = tokens.find((t) => t.id === v) || null;
          onTokenChange(token);
        }}
        disabled={!tokens.length || disabled}
      >
        <SelectTrigger id="from-token">
          <SelectValue placeholder="Select asset">
            {tokenLabel(selectedToken)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {tokens
            .filter((t) => t.externalSymbol || t.externalName)
            .map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {tokenLabel(t)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default TokenSelector;

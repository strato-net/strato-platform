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
}

const TokenSelector: React.FC<TokenSelectorProps> = ({
  selectedToken,
  tokens,
  onTokenChange,
  disabled = false,
}) => {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="from-token">Select asset</Label>
      <Select
        value={selectedToken?.externalSymbol || ""}
        onValueChange={(v) => {
          const token =
            tokens.find((t) => t.externalSymbol === v) || null;
          onTokenChange(token);
        }}
        disabled={!tokens.length || disabled}
      >
        <SelectTrigger id="from-token">
          <SelectValue placeholder="Select asset">
            {selectedToken?.externalSymbol || "Select asset"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {tokens
            .filter((t) => t.externalSymbol)
            .map((t) => (
              <SelectItem key={t.id} value={String(t.externalSymbol)}>
                {t.externalSymbol}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default TokenSelector;


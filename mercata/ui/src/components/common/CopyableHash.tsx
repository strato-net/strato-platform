import React from "react";
import { useToast } from "../../hooks/use-toast.ts";

interface CopyableHashProps {
  hash: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
  showInstructions?: boolean;
  truncate?: boolean;
  truncateLength?: number;
}

export const CopyableHash: React.FC<CopyableHashProps> = ({
  hash,
  label = "Hash:",
  className = "",
  showLabel = true,
  showInstructions = true,
  truncate = false,
  truncateLength = 16
}) => {
  const { toast } = useToast();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(hash);
    toast({
      title: "Copied!",
      description: "Transaction hash copied to clipboard",
    });
  };

  const displayHash = truncate && hash.length > truncateLength * 2
    ? `${hash.slice(0, truncateLength)}...${hash.slice(-truncateLength)}`
    : hash;

  return (
    <div className={`space-y-1 ${className}`}>
      <div 
        className="bg-muted p-2 rounded text-xs font-mono cursor-pointer hover:bg-muted/80 transition-colors border border-border"
        onClick={copyToClipboard}
        title="Click to copy transaction hash"
      >
        {showLabel && <span className="text-muted-foreground">{label} </span>}
        <span className="text-blue-600 select-all">{displayHash}</span>
      </div>
      {showInstructions && (
        <p className="text-xs text-muted-foreground">Click hash to copy</p>
      )}
    </div>
  );
};

export default CopyableHash;

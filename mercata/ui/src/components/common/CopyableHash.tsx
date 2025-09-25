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
        className="bg-gray-100 p-2 rounded text-xs font-mono cursor-pointer hover:bg-gray-200 transition-colors border"
        onClick={copyToClipboard}
        title="Click to copy transaction hash"
      >
        {showLabel && <span className="text-gray-600">{label} </span>}
        <span className="text-blue-600 select-all">{displayHash}</span>
      </div>
      {showInstructions && (
        <p className="text-xs text-gray-500">Click hash to copy</p>
      )}
    </div>
  );
};

export default CopyableHash;

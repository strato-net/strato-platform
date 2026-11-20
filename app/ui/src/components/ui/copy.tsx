import { Copy, CopyCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { useState } from "react";

const CopyButton = ({ address, label = "address" }) => {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    address && <Tooltip open={copied || undefined}>
      <TooltipTrigger asChild>
        <button
          onClick={copyToClipboard}
          className={`ml-1 transition-colors duration-200 ${copied ? "text-green-600" : "text-muted-foreground hover:text-foreground"
            }`}
          aria-label={`Copy ${label}`}
          onBlur={() => setCopied(false)}
        >
          {copied ? (
            <CopyCheck size={14} />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{copied ? "Copied!" : `Copy ${label}`}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default CopyButton
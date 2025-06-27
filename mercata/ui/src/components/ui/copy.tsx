import { Copy, CopyCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { useState } from "react";

const CopyButton = ({ address }) => {
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
          className={`ml-1 transition-colors duration-200 ${copied ? "text-green-600" : "text-gray-400 hover:text-gray-600"
            }`}
          aria-label="Copy address"
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
        <p>{copied ? "Copied!" : "Copy address"}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export default CopyButton
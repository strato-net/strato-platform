import { ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const ExplorerButton = ({ url }: { url: string }) => {
  return (
    url && (
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors duration-200"
            aria-label="View on explorer"
          >
            <ExternalLink size={14} />
          </a>
        </TooltipTrigger>
        <TooltipContent>
          <p>View on explorer</p>
        </TooltipContent>
      </Tooltip>
    )
  );
};

export default ExplorerButton;

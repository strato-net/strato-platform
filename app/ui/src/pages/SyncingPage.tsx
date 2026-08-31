import { useEffect, useState } from "react";
import type { NodeHealth } from "@/lib/nodeHealth";

interface SyncingPageProps {
  nodeHealth?: NodeHealth | null;
}

const SyncingPage = ({ nodeHealth }: SyncingPageProps) => {
  const [dots, setDots] = useState("");
  const status = nodeHealth?.healthStatus || "SYNCING";
  const issues = nodeHealth?.healthIssues?.filter(Boolean) || [];
  const isStalled = nodeHealth?.nodeSync?.isSyncStalled === true || status === "SYNC STALLED";
  const title = isStalled
    ? "Sync paused"
    : status === "UNHEALTHY"
      ? "Connection trouble"
      : "Catching up with the network";
  const description = isStalled
    ? "The node has stopped catching up with the network. This usually resolves on its own — you can leave this page open."
    : status === "UNHEALTHY"
      ? "The node is having trouble right now. This usually resolves on its own — you can leave this page open."
      : "The node is downloading the latest activity. This usually resolves on its own — you can leave this page open.";

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-lg mx-auto p-8">
        <div className="mb-8">
          <div className="relative w-20 h-20 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-muted"></div>
            <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-4">
          {title}{isStalled || status === "UNHEALTHY" ? "" : dots}
        </h1>
        <p className="text-lg text-muted-foreground mb-6">
          {description}
        </p>
        {issues.length > 0 && (
          <div className="mb-6 rounded-md border border-border bg-muted/40 p-4 text-left text-sm text-muted-foreground">
            <div className="mb-2 font-medium text-foreground">Current status</div>
            <ul className="list-disc space-y-1 pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {nodeHealth?.nodeSync && (
          <p className="text-xs text-muted-foreground mb-3">
            Sync check: {nodeHealth.nodeSync.latestCheckTimestamp || nodeHealth.timestamp || "pending"}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          This page will automatically refresh when the node is ready.
        </p>
      </div>
    </div>
  );
};

export default SyncingPage;

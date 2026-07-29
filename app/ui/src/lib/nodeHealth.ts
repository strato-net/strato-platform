export interface NodeHealth {
  timestamp?: string;
  health: boolean | null;
  healthStatus?: string | null;
  healthIssues?: string[] | null;
  nodeSync?: {
    isSynced?: boolean | null;
    isSyncStalled?: boolean | null;
    latestCheckTimestamp?: string | null;
    lastFailureTimestamp?: string | null;
  } | null;
  stallHealth?: {
    health?: boolean | null;
    validBlocksIncreased?: boolean | null;
    hasPendingTxs?: boolean | null;
    latestCheckTimestamp?: string | null;
    lastFailureTimestamp?: string | null;
  } | null;
}

export const getNodeHealth = async (): Promise<NodeHealth | null> => {
  try {
    const response = await fetch("/health", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
};

export const shouldShowNodeHealth = (health: NodeHealth | null): health is NodeHealth => {
  if (!health) return false;
  if (health.health === false) return true;
  if (health.nodeSync?.isSynced === false) return true;
  return health.nodeSync?.isSyncStalled === true;
};

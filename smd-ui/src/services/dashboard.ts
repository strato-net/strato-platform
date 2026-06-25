import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

export interface NodeStatus {
  apiVersion?: string;
  version?: string;
  timestamp?: string;
  nodeAddress?: string;
  lastBlock?: { number?: number | string; hash?: string; parentHash?: string };
  pbftData?: any;
  health?: boolean;
  healthStatus?: string;
  healthIssues?: string[];
  uptime?: number;
}

/**
 * Poll /apex-api/status for node identity, health, last block, and validators.
 * This endpoint requires an authenticated session, so pass `enabled=false` for
 * guests to avoid 401s (and hide the dependent widgets).
 */
export function useNodeStatus(enabled = true) {
  return useQuery({
    queryKey: ["node-status"],
    enabled,
    queryFn: async (): Promise<NodeStatus> => {
      const { data } = await api.get(`${env.APEX_URL}/status`);
      return data;
    },
    refetchInterval: 15000,
  });
}

export interface NodeMetadata {
  nodeAddress?: string;
  validators?: string[];
  isSynced?: boolean;
}

/** GET /strato-api/eth/v1.2/metadata — node address, validator set, sync status. */
export function useNodeMetadata() {
  return useQuery({
    queryKey: ["node-metadata"],
    queryFn: async (): Promise<NodeMetadata> => {
      const { data } = await api.get(`${env.STRATO_URL}/metadata`);
      return data || {};
    },
    refetchInterval: 15000,
  });
}

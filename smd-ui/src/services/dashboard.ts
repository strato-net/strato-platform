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

/** Poll /apex-api/status for node identity, health, last block, and validators. */
export function useNodeStatus() {
  return useQuery({
    queryKey: ["node-status"],
    queryFn: async (): Promise<NodeStatus> => {
      const { data } = await api.get(`${env.APEX_URL}/status`);
      return data;
    },
    refetchInterval: 15000,
  });
}

/** Best-effort extraction of validator addresses from pbftData (shape varies by node). */
export function extractValidators(pbftData: any): string[] {
  if (!pbftData) return [];
  const candidates =
    pbftData.validators ||
    pbftData.validatorList ||
    pbftData.view?.validators ||
    pbftData.commiters ||
    pbftData.committers;
  if (Array.isArray(candidates)) {
    return candidates.map((v: any) => (typeof v === "string" ? v : v?.address || v?.commonName || String(v)));
  }
  return [];
}

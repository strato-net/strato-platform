import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { useUser } from "@/context/UserContext";
import { simulateStratoTx, type SimulationResult } from "@/services/simulation";
import type { StratoTxType } from "@/lib/walletTx";

/**
 * Local state around simulateStratoTx, mirroring useSubmitTransaction's shape.
 * Session users authenticate via their cookie (nginx injects the token);
 * anonymous external-wallet users authenticate by connected address only.
 */
export function useSimulation() {
  const { isAppAuthenticated } = useUser();
  const { address } = useAccount();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");

  const run = useCallback(
    async (
      type: StratoTxType,
      payload: Record<string, unknown>,
      // `address` overrides the caller identity (msg.sender), e.g. to simulate
      // a multisig-executed effect as if it came from the wallet contract.
      opts?: { username?: string; address?: string }
    ): Promise<SimulationResult | null> => {
      setPending(true);
      setResult(null);
      setError("");
      try {
        const res = await simulateStratoTx(type, payload, {
          username: opts?.username?.trim() || undefined,
          address: opts?.address ?? (!isAppAuthenticated && address ? address : undefined),
        });
        setResult(res);
        return res;
      } catch (err: any) {
        setError(typeof err === "string" ? err : String(err?.message || err));
        return null;
      } finally {
        setPending(false);
      }
    },
    [isAppAuthenticated, address]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError("");
  }, []);

  // Available whenever a transaction could be submitted. Simulation always
  // runs against the node's main chain (SMD has no sub-chain selector), which
  // is the same chain SMD posts to, so no chain gating is needed here.
  const canSimulate = isAppAuthenticated || !!address;
  return { run, reset, pending, result, error, canSimulate };
}

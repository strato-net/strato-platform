import { api } from "@/lib/api";
import { env } from "@/lib/env";
import type { StratoTxType } from "@/lib/walletTx";

// Result shape of POST /bloc/v2.2/transaction/simulate (BlocSimulateResult).
// `data` mirrors posted-transaction results (Call/Upload), `response` is the
// raw SolidVM return value, `trace` a callTracer-style frame tree.

export interface SimulatedEvent {
  address: string;
  name: string;
  args: Record<string, string>;
}

export interface TraceStatement {
  source: string;
  line: number;
  column: number;
  depth: number;
  gasLeft: number;
}

export interface TraceFrame {
  type: string;
  from: string;
  to: string;
  contract: string;
  function: string;
  args: string[];
  gas: number;
  gasUsed: number;
  output?: string;
  error?: string;
  logs?: SimulatedEvent[];
  calls?: TraceFrame[];
  statements?: TraceStatement[];
}

export interface SimulationResult {
  status: "Success" | "Failure";
  gasUsed: number;
  response?: unknown;
  data?: { tag: "Call" | "Upload" | "Send"; contents: unknown } | null;
  events: SimulatedEvent[];
  error?: string | null;
  trace?: TraceFrame | TraceFrame[] | null;
  /**
   * For a castVoteOnIssue simulation, the independently-simulated effect the
   * issue would have if the vote reached threshold now (target.func(args) run
   * as the registry/wallet). When the effect is itself a castVoteOnIssue — a
   * vote wrapped through nested multisigs — the server keeps recursing, so this
   * forms a chain ending at the ultimate issue's action. Each hop runs in a
   * fresh sandbox against current state.
   */
  effect?: SimulationResult | null;
}

/**
 * The `executed` flag from a simulated castVoteOnIssue result: the AdminRegistry
 * returns (bool executed, …) — true when this vote itself crossed the threshold.
 * `response` is the raw SolidVM value JSON ({t:"tup",v:[{t:"bool",v:…},…]}).
 * Returns null when the response isn't shaped like a castVoteOnIssue return.
 */
export function decodeCastVoteOutcome(response: unknown): boolean | null {
  const r = response as { t?: string; v?: unknown } | null;
  if (!r || typeof r !== "object") return null;
  if (r.t === "bool") return !!r.v;
  if (r.t === "tup" && Array.isArray(r.v)) {
    const first = r.v[0] as { t?: string; v?: unknown } | null;
    if (first && typeof first === "object" && first.t === "bool") return !!first.v;
  }
  return null;
}

/** Flatten a simulation result and its nested effect chain, root first. */
export function simulationChain(result: SimulationResult | null): SimulationResult[] {
  const out: SimulationResult[] = [];
  for (let r = result; r; r = r.effect ?? null) out.push(r);
  return out;
}

/**
 * Dry-run a transaction in the node's VM sandbox. Takes the exact payload
 * shape POST /transaction takes, so callers can reuse their submit payloads.
 * Nothing is signed or committed; state changes are discarded.
 */
export async function simulateStratoTx(
  type: StratoTxType,
  payload: Record<string, unknown>,
  opts?: { username?: string; address?: string; trace?: boolean }
): Promise<SimulationResult> {
  // No `chainid` param: simulation runs against the node's main chain, which is
  // the chain SMD posts to. The bloc endpoint rejects an explicit chainid.
  const body: Record<string, unknown> = { txs: [{ payload, type }] };
  if (opts?.address) body.address = opts.address.replace(/^0x/, "");
  const { data } = await api.post(`${env.BLOC_URL}/transaction/simulate`, body, {
    params: {
      ...(opts?.username ? { username: opts.username } : {}),
      ...(opts?.trace === false ? {} : { trace: true }),
    },
    // Guests (external wallet, no session) have no CSRF token; the marker
    // header opts into nginx's wallet_tx_routes CSRF exemption for this
    // effect-free dry-run endpoint.
    headers: opts?.address ? { "X-Wallet-Address": opts.address.replace(/^0x/, "") } : undefined,
    skipErrorToast: true,
  });
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new Error("Empty simulation response");
  return result as SimulationResult;
}

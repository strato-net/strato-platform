// Dry-run admin votes against the node's VM sandbox. The app UI can't reach the
// node's /bloc endpoint directly (its nginx only proxies /api and /rpc), so this
// goes through the app backend, which forwards to the bloc simulate endpoint.
// Simulating castVoteOnIssue returns both the immediate vote tx result and
// (nested under `effect`) what the issue would execute if the vote passed —
// target.func(args) run as the AdminRegistry — so admins can preview an issue's
// real impact before voting.
import { api } from "@/lib/axios";

export interface SimulatedEvent {
  address: string;
  name: string;
  args: Record<string, string>;
}

export interface SimulationTraceFrame {
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
  calls?: SimulationTraceFrame[];
}

export interface SimulationResult {
  status: "Success" | "Failure";
  gasUsed: number;
  response?: unknown;
  data?: { tag: "Call" | "Upload" | "Send"; contents: unknown } | null;
  events: SimulatedEvent[];
  error?: string | null;
  trace?: SimulationTraceFrame | SimulationTraceFrame[] | null;
  // For a castVoteOnIssue simulation: the effect the issue would have if the
  // vote reached its threshold now. Nested results never carry their own effect.
  effect?: SimulationResult | null;
}

/**
 * Simulate casting a vote on an admin issue. Returns the vote tx result with the
 * issue's "effect if executed" nested under `.effect`. The voting admin (the
 * vote's msg.sender) is the authenticated session user, resolved server-side.
 */
export async function simulateAdminVote(issue: {
  target: string;
  func: string;
  args: unknown[];
}): Promise<SimulationResult> {
  const { data } = await api.post(
    "/user/admin/vote/simulate",
    { target: issue.target, func: issue.func, args: issue.args },
    { walletAuth: false } as never
  );
  if (!data) throw new Error("Empty simulation response");
  return data as SimulationResult;
}

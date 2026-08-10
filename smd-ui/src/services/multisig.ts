import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { strip0x, ZERO_ADDRESS, type UserWallet } from "@/services/userWallets";

/**
 * The AdminRegistry proxy is deployed at 0x100c in genesis. It owns itself and
 * delegatecalls to its logic contract (0x110c in genesis, read dynamically here in
 * case it has been upgraded). Setting a User wallet's logic contract to this same
 * logic address turns the wallet into a self-governed multisig — the AdminRegistry
 * voting logic runs against the wallet's own storage.
 */
export const ADMIN_REGISTRY_ADDRESS = "000000000000000000000000000000000000100c";
/** Genesis address of the AdminRegistry logic code; last-resort fallback only. */
export const ADMIN_REGISTRY_IMPL_FALLBACK = "000000000000000000000000000000000000110c";

/** thresholds are stored in basis points: 6000 = 60%. */
export const bpsToPct = (bps: number) => Math.round((bps / 100) * 10) / 10;
export const pctToBps = (pct: number) => Math.round(pct * 100);

export function isZeroAddr(a?: string | null): boolean {
  return !a || /^0*$/.test(strip0x(a));
}

const cirrusGet = async (table: string, query: string): Promise<any[]> => {
  const { data } = await api.get(`${env.CIRRUS_URL}/${table}?${query}`);
  return Array.isArray(data) ? data : [];
};

/** Read the flat state (`data`) blob a contract's storage row holds in cirrus. */
async function fetchStorageData(address: string): Promise<Record<string, any>> {
  const rows = await cirrusGet("storage", `address=eq.${strip0x(address)}&select=data`);
  const data = rows[0]?.data;
  return data && typeof data === "object" ? data : {};
}

// ---- Reads --------------------------------------------------------------------------

/**
 * The AdminRegistry's current logic-contract address — what a wallet delegates to so
 * it behaves as a multisig. Reads 0x100c's `logicContract`; falls back to the known
 * genesis impl if cirrus hasn't indexed it.
 */
export function useAdminRegistryLogic() {
  const q = useQuery({
    queryKey: ["admin-registry-logic"],
    queryFn: async (): Promise<string> => {
      const data = await fetchStorageData(ADMIN_REGISTRY_ADDRESS);
      const raw = strip0x(String(data["logicContract"] ?? ""));
      return isZeroAddr(raw) ? ADMIN_REGISTRY_IMPL_FALLBACK : raw;
    },
    staleTime: 5 * 60_000,
  });
  return { logic: q.data ?? "", ...q };
}

export interface MultisigConfig {
  /** logic contract the wallet currently delegates to (empty/zero if none). */
  logicContract: string;
  /** true once the AdminRegistry logic has been initialized on this wallet. */
  initialized: boolean;
  /** current owner of the wallet (self-owned when multisig is fully enabled). */
  owner: string;
  /** default voting threshold in basis points (e.g. 6000 = 60%). */
  defaultThresholdBps: number;
}

/** A User wallet's multisig-relevant state, read from its cirrus storage blob. */
export function useMultisigConfig(walletAddress?: string | null) {
  const q = useQuery({
    queryKey: ["multisig-config", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 12_000,
    queryFn: async (): Promise<MultisigConfig> => {
      const data = await fetchStorageData(walletAddress!);
      return {
        logicContract: strip0x(String(data["logicContract"] ?? "")),
        initialized: data["initialized"] === true || data["initialized"] === "true",
        owner: strip0x(String(data["_owner"] ?? data["owner"] ?? "")),
        defaultThresholdBps: Number(data["defaultVotingThresholdBps"] ?? 0) || 0,
      };
    },
  });
  const config: MultisigConfig = q.data ?? {
    logicContract: "",
    initialized: false,
    owner: "",
    defaultThresholdBps: 0,
  };
  return { config, ...q };
}

/**
 * Whether a User wallet is running as a multisig (it delegates to the AdminRegistry
 * logic). `fullyEnabled` additionally requires the wallet to own itself and be
 * initialized — the state in which signer votes can actually execute.
 */
export function useIsMultisig(walletAddress?: string | null) {
  const { logic: adminLogic } = useAdminRegistryLogic();
  const { config, isLoading, refetch } = useMultisigConfig(walletAddress);
  const delegatesToAdmin =
    !isZeroAddr(config.logicContract) &&
    !!adminLogic &&
    strip0x(config.logicContract) === strip0x(adminLogic);
  const selfOwned = !!walletAddress && strip0x(config.owner) === strip0x(walletAddress);
  return {
    isMultisig: delegatesToAdmin,
    fullyEnabled: delegatesToAdmin && selfOwned && config.initialized,
    selfOwned,
    initialized: config.initialized,
    config,
    isLoading,
    refetch,
  };
}

/** Current signer (admin) addresses for a multisig wallet, from the `admins` array. */
export function useSigners(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-signers", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 12_000,
    queryFn: async (): Promise<string[]> => {
      const rows = await cirrusGet(
        "mapping",
        `collection_name=eq.admins&address=eq.${strip0x(walletAddress!)}&select=key,value`
      );
      // Removed admins are zeroed out and the array shrinks; keep only live entries.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of rows) {
        const addr = strip0x(String(r?.value ?? ""));
        if (!addr || isZeroAddr(addr) || seen.has(addr)) continue;
        seen.add(addr);
        out.push(addr);
      }
      return out;
    },
  });
}

/** Per-(target,func) voting thresholds (bps), keyed `"<target>|<func>"`. */
export function useVotingThresholds(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-thresholds", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const rows = await cirrusGet(
        "mapping",
        `collection_name=eq.votingThresholds&address=eq.${strip0x(walletAddress!)}&select=key,value`
      );
      const out: Record<string, number> = {};
      for (const r of rows) {
        const target = strip0x(String(r?.key?.key ?? ""));
        const func = String(r?.key?.key2 ?? "");
        const bps = Number(r?.value ?? 0) || 0;
        if (target && func && bps > 0) out[`${target}|${func}`] = bps;
      }
      return out;
    },
  });
}

// ---- Nested multisig membership ----------------------------------------------------

/** Safety cap on how many membership hops we follow when discovering ancestors. */
export const MAX_NESTING_DEPTH = 4;

/**
 * A multisig reachable through nested membership: the connected account signs
 * `route[0]` directly, each `route[i]` is a signer (admin) on `route[i+1]`, and the
 * last entry is the multisig itself. Votes travel the route as wrapped
 * castVoteOnIssue issues: each hop must pass its own threshold before its vote
 * lands on the next.
 */
export interface MultisigMembership {
  wallet: UserWallet;
  route: UserWallet[];
}

/** Display name for a multisig that may not be a username'd User wallet. */
export function multisigDisplayName(w: { address: string; username?: string }): string {
  if (w.username) return w.username;
  if (eqAddr(w.address, ADMIN_REGISTRY_ADDRESS)) return "AdminRegistry (global)";
  return "";
}

const eqAddr = (a?: string, b?: string) => !!a && !!b && strip0x(a) === strip0x(b);

/**
 * One level of reverse adminMap lookup: which contracts list any of `children`
 * as a signer? Returns parent rows keyed by the child address they contain.
 * The parent may be a User-wallet multisig (has a username) or a global
 * registry like 0x100c (no username) — both are valid vote targets.
 */
async function fetchParentMultisigs(children: string[]): Promise<Map<string, UserWallet[]>> {
  if (children.length === 0) return new Map();
  const keys = children.map(strip0x).join(",");
  const rows = await cirrusGet(
    "mapping",
    `collection_name=eq.adminMap&key-%3E%3Ekey=in.(${keys})&value=gt.0` +
      `&select=address,key,storage(data-%3E%3Eusername)`
  );
  const out = new Map<string, UserWallet[]>();
  for (const row of rows) {
    const parent = strip0x(String(row?.address ?? ""));
    const child = strip0x(String(row?.key?.key ?? ""));
    if (!parent || !child) continue;
    const s = row?.storage;
    const data = Array.isArray(s) ? s[0] : s;
    const username = data?.username ?? "";
    const list = out.get(child) ?? [];
    if (!list.some((w) => eqAddr(w.address, parent)))
      list.push({ address: parent, username, multisig: true });
    out.set(child, list);
  }
  return out;
}

/**
 * Multisigs the connected account can vote in *indirectly*, because a multisig
 * it signs is itself a signer somewhere else (possibly through several levels).
 * Seeds are the wallets from useMyUserWallets tagged `multisig` (direct
 * signerships). An ancestor is reported even when the account is *also* a
 * direct signer there — voting through the route casts the intermediate
 * multisig's vote, a different identity than voting directly. Breadth-first,
 * so each ancestor is reported with its shortest membership route.
 */
export function useNestedMultisigs(myWallets?: UserWallet[]) {
  const seeds = (myWallets ?? []).filter((w) => w.multisig);
  const seedKey = seeds
    .map((w) => strip0x(w.address))
    .sort()
    .join(",");
  return useQuery({
    queryKey: ["nested-multisigs", seedKey],
    enabled: seeds.length > 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<MultisigMembership[]> => {
      // `emitted` dedupes results (shortest route wins); `expanded` stops the
      // BFS from re-walking a wallet's parents (and with it, cycles).
      const emitted = new Set<string>();
      const expanded = new Set(seeds.map((w) => strip0x(w.address)));
      let frontier: MultisigMembership[] = seeds.map((w) => ({ wallet: w, route: [w] }));
      const out: MultisigMembership[] = [];
      for (let depth = 0; depth < MAX_NESTING_DEPTH && frontier.length > 0; depth++) {
        const parents = await fetchParentMultisigs(frontier.map((f) => f.wallet.address));
        const next: MultisigMembership[] = [];
        for (const f of frontier) {
          for (const parent of parents.get(strip0x(f.wallet.address)) ?? []) {
            const key = strip0x(parent.address);
            if (key === strip0x(f.wallet.address)) continue; // self-membership
            if (emitted.has(key)) continue;
            emitted.add(key);
            const entry: MultisigMembership = { wallet: parent, route: [...f.route, parent] };
            out.push(entry);
            if (!expanded.has(key)) {
              expanded.add(key);
              next.push(entry);
            }
          }
        }
        frontier = next;
      }
      return out;
    },
  });
}

/**
 * The multisigs a wallet is itself a signer (admin) on — one level up. Used by
 * the multisig dialog to show where this wallet's vote carries weight.
 */
export function useParentMultisigs(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-parents", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30_000,
    queryFn: async (): Promise<UserWallet[]> => {
      const parents = await fetchParentMultisigs([walletAddress!]);
      return (parents.get(strip0x(walletAddress!)) ?? []).filter(
        (p) => !eqAddr(p.address, walletAddress!)
      );
    },
  });
}

export interface OpenIssue {
  issueId: string;
  target: string;
  func: string;
  /** Decoded call arguments (best-effort; used to re-cast a vote on the issue). */
  args: string[];
  /** Addresses that have voted so far. */
  voters: string[];
  createdBlock?: number;
}

function normalizeArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      } catch {
        /* fall through */
      }
    }
    return [s];
  }
  return [String(raw)];
}

/**
 * Open (unexecuted) issues for a multisig wallet. Derived from the `votes` collection
 * — an issue is open while it still has non-zero voters (execution/dismissal clears
 * them) — joined to its `IssueCreated` event for target/func/args.
 */
export function useOpenIssues(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-open-issues", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 10_000,
    queryFn: async (): Promise<OpenIssue[]> => {
      const addr = strip0x(walletAddress!);
      const [voteRows, created] = await Promise.all([
        cirrusGet("mapping", `collection_name=eq.votes&address=eq.${addr}&select=key,value`),
        cirrusGet(
          "event",
          `address=eq.${addr}&event_name=eq.IssueCreated&order=block_timestamp.desc&select=attributes,block_number`
        ),
      ]);

      // Group live votes by issueId (drop zeroed-out / cleared entries).
      const votersByIssue = new Map<string, string[]>();
      for (const r of voteRows) {
        const issueId = String(r?.key?.key ?? "");
        const voter = strip0x(String(r?.value ?? ""));
        if (!issueId || isZeroAddr(voter)) continue;
        const list = votersByIssue.get(issueId) ?? [];
        if (!list.includes(voter)) list.push(voter);
        votersByIssue.set(issueId, list);
      }

      // Latest IssueCreated per issueId for the call details.
      const detailsByIssue = new Map<string, { target: string; func: string; args: string[]; block?: number }>();
      for (const ev of created) {
        const a = ev?.attributes ?? {};
        const issueId = String(a.issueId ?? "");
        if (!issueId || detailsByIssue.has(issueId)) continue;
        detailsByIssue.set(issueId, {
          target: strip0x(String(a.target ?? "")),
          func: String(a.func ?? ""),
          args: normalizeArgs(a.args),
          block: ev?.block_number ? Number(ev.block_number) : undefined,
        });
      }

      const issues: OpenIssue[] = [];
      for (const [issueId, voters] of votersByIssue) {
        const d = detailsByIssue.get(issueId);
        issues.push({
          issueId,
          target: d?.target ?? "",
          func: d?.func ?? "",
          args: d?.args ?? [],
          voters,
          createdBlock: d?.block,
        });
      }
      issues.sort((a, b) => (b.createdBlock ?? 0) - (a.createdBlock ?? 0));
      return issues;
    },
  });
}

export interface ExecutedIssue {
  issueId: string;
  target: string;
  func: string;
  args: string[];
  executor: string;
  block?: number;
  timestamp?: string;
  txHash?: string;
}

/** Executed-issue history for a multisig wallet, newest first (paginated). */
export function useExecutedIssues(walletAddress?: string | null, limit = 10, offset = 0) {
  return useQuery({
    queryKey: ["multisig-executed-issues", walletAddress, limit, offset],
    enabled: !!walletAddress,
    queryFn: async (): Promise<ExecutedIssue[]> => {
      const rows = await cirrusGet(
        "event",
        `address=eq.${strip0x(walletAddress!)}&event_name=eq.IssueExecuted` +
          `&order=block_timestamp.desc&limit=${limit}&offset=${offset}` +
          `&select=attributes,block_number,block_timestamp,transaction_hash`
      );
      return rows.map((ev) => {
        const a = ev?.attributes ?? {};
        return {
          issueId: String(a.issueId ?? ""),
          target: strip0x(String(a.target ?? "")),
          func: String(a.func ?? ""),
          args: normalizeArgs(a.args),
          executor: strip0x(String(a.executor ?? "")),
          block: ev?.block_number ? Number(ev.block_number) : undefined,
          timestamp: ev?.block_timestamp,
          txHash: ev?.transaction_hash,
        };
      });
    },
  });
}

/** Votes needed to execute, given the signer count and threshold (bps). */
export function votesNeeded(signerCount: number, thresholdBps: number): number {
  if (!signerCount || !thresholdBps) return signerCount || 1;
  // Matches the contract: 10000 * votes >= thresholdBps * admins.length.
  return Math.ceil((thresholdBps * signerCount) / 10000);
}

// ---- Writes -------------------------------------------------------------------------

export interface MultisigActionCtx {
  /** The multisig User wallet contract address. */
  walletAddress: string;
  /**
   * Nested-membership route ending at `walletAddress` (see MultisigMembership).
   * When present with >1 entry, votes are wrapped through each hop instead of
   * being cast on the wallet directly. Omit (or pass [walletAddress]) for a
   * wallet the connected account signs directly.
   */
  route?: string[];
}

/**
 * Actions that mutate a multisig wallet. Every call targets the User wallet contract
 * directly (no `username` wrapping): governance functions (castVoteOnIssue, addAdmin,
 * …) are public and reach the AdminRegistry logic through the wallet's Proxy fallback;
 * owner-gated setup functions (setLogicContract, initialize, transferOwnership) are
 * signed by the connected owner while they still own the wallet.
 */
/** FUNCTION payload for a governance call on the User wallet contract itself. */
export function buildWalletCallPayload(
  walletAddress: string,
  method: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  return {
    contractName: "User",
    contractAddress: walletAddress,
    value: 0,
    method,
    args,
    metadata: {},
  };
}

/** FUNCTION payload for the castVoteOnIssue proposal transaction. */
export function buildCastVotePayload(
  walletAddress: string,
  func: string,
  args: string[],
  target?: string
): Record<string, unknown> {
  return buildWalletCallPayload(walletAddress, "castVoteOnIssue", {
    _target: strip0x(target || walletAddress),
    _func: func,
    _args: args,
  });
}

/**
 * FUNCTION payload for a vote travelling a nested-membership route.
 * `route` = [multisig the sender signs directly, …, wallet holding the issue];
 * the ultimate issue is `target.func(args)` on the final wallet. Each hop wraps
 * the next as castVoteOnIssue(nextHop, "castVoteOnIssue", [target, func, …args])
 * — variadic args flatten, so when hop i's threshold passes it casts hop i+1's
 * vote verbatim and the issueId at every level matches direct votes.
 * A single-entry route degenerates to buildCastVotePayload.
 */
export function buildNestedCastVotePayload(
  route: string[],
  func: string,
  args: string[],
  target?: string
): Record<string, unknown> {
  if (route.length === 0) throw new Error("empty vote route");
  const finalWallet = strip0x(route[route.length - 1]);
  let t = strip0x(target || finalWallet);
  let f = func;
  let a = args.map((x) => String(x));
  for (let i = route.length - 1; i >= 1; i--) {
    a = [t, f, ...a];
    f = "castVoteOnIssue";
    t = strip0x(route[i]);
  }
  return buildWalletCallPayload(strip0x(route[0]), "castVoteOnIssue", {
    _target: t,
    _func: f,
    _args: a,
  });
}

export function useMultisigActions({ walletAddress, route }: MultisigActionCtx) {
  const { submit } = useSubmitTransaction();
  // A route is only "nested" once it has an intermediate hop before the wallet.
  const routeKey = (route ?? [walletAddress]).map(strip0x).join(">");
  const voteRoute = useMemo(
    () => (route && route.length > 1 ? route : [walletAddress]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeKey]
  );
  const nested = voteRoute.length > 1;

  const callWallet = useCallback(
    (method: string, args: Record<string, unknown>) =>
      submit("FUNCTION", buildWalletCallPayload(walletAddress, method, args)),
    [submit, walletAddress]
  );

  /** Step 1: delegate the wallet's governance to the AdminRegistry logic. */
  const setLogic = useCallback(
    (adminLogic: string) => callWallet("setLogicContract", { _logicContract: strip0x(adminLogic) }),
    [callWallet]
  );

  /** Step 2: seed the signer (admin) set. Callable once. */
  const initializeSigners = useCallback(
    (signers: string[]) => {
      const clean = Array.from(
        new Set(signers.map(strip0x).filter((a) => a.length === 40 && !isZeroAddr(a)))
      );
      if (clean.length === 0) throw new Error("At least one signer is required");
      return callWallet("initialize", { _initialAdmins: clean });
    },
    [callWallet]
  );

  /**
   * Step 3: transfer ownership to the wallet itself. After this the wallet owns
   * itself — the previous owner keeps power only as a signer, and every owner-gated
   * action becomes a signer vote (reversible later by a vote).
   */
  const lockToSelf = useCallback(
    () => callWallet("transferOwnership", { newOwner: strip0x(walletAddress) }),
    [callWallet, walletAddress]
  );

  /**
   * Turn the wallet into a self-governed multisig, running only the steps still
   * needed given `have` (so a partially-enabled wallet can be resumed safely):
   *  1. setLogicContract(adminLogic)  2. initialize([signers])  3. transferOwnership(self)
   */
  const enableMultisig = useCallback(
    async (
      adminLogic: string,
      signers: string[],
      have?: { logicSet?: boolean; initialized?: boolean; selfOwned?: boolean }
    ) => {
      if (!have?.logicSet) await setLogic(adminLogic);
      if (!have?.initialized) await initializeSigners(signers);
      if (!have?.selfOwned) await lockToSelf();
    },
    [setLogic, initializeSigners, lockToSelf]
  );

  /**
   * Cast a vote on (or create) an arbitrary issue. When the threshold is reached the
   * wallet executes `target.func(args)`; `target` defaults to the wallet itself.
   * With a nested route, the vote is submitted to the first hop wrapped as a chain
   * of castVoteOnIssue issues (the issueId on this wallet still matches direct votes).
   */
  const castVote = useCallback(
    (func: string, args: string[], target?: string) =>
      submit(
        "FUNCTION",
        buildNestedCastVotePayload(voteRoute, func, args, target || walletAddress)
      ),
    [submit, voteRoute, walletAddress]
  );

  /**
   * Propose/vote to add a signer (executes once the vote threshold is met). Direct
   * signers use the public `addAdmin` wrapper; a nested vote instead targets the
   * internal `_addAdmin` issue the wrapper creates, so both land on the same issueId.
   */
  const addSigner = useCallback(
    (address: string) =>
      nested
        ? castVote("_addAdmin", [strip0x(address)])
        : callWallet("addAdmin", { _admin: strip0x(address) }),
    [nested, castVote, callWallet]
  );

  /** Propose/vote to remove a signer. */
  const removeSigner = useCallback(
    (address: string) =>
      nested
        ? castVote("_removeAdmin", [strip0x(address)])
        : callWallet("removeAdmin", { _admin: strip0x(address) }),
    [nested, castVote, callWallet]
  );

  /** Propose/vote to swap a signer for a new address in a single issue. */
  const swapSigner = useCallback(
    (oldAddress: string, newAddress: string) =>
      nested
        ? castVote("_swapAdmin", [strip0x(oldAddress), strip0x(newAddress)])
        : callWallet("swapAdmin", {
            _adminToReplace: strip0x(oldAddress),
            _newAdmin: strip0x(newAddress),
          }),
    [nested, castVote, callWallet]
  );

  /**
   * Propose/vote to change the default voting threshold (basis points). Unlike
   * add/remove-signer, `setDefaultVotingThresholdBps` has no public vote wrapper and is
   * `onlyOwner`, so we vote on it explicitly via castVoteOnIssue (the wallet executes
   * it on itself once the threshold is met).
   */
  const setDefaultThreshold = useCallback(
    (bps: number) => castVote("setDefaultVotingThresholdBps", [String(bps)]),
    [castVote]
  );

  /**
   * Dismiss (withdraw) an open issue. The AdminRegistry only allows this while the
   * issue has exactly one vote, cast by the caller — so this stays a direct call:
   * a nested member's vote is recorded under the intermediate multisig's address,
   * never their own, and the dialog disables Dismiss accordingly.
   */
  const dismissIssue = useCallback(
    (issueId: string) => callWallet("dismissIssue", { _issueId: issueId }),
    [callWallet]
  );

  /**
   * Propose/vote to transfer `amountRaw` (smallest units) of the token at
   * `tokenAddress` out of the treasury to `to`. Executes as `token.transfer(to,
   * amount)` from the wallet once the vote threshold is met. Args are normalized so
   * every vote on the same transfer maps to the same issueId.
   */
  const proposeTransfer = useCallback(
    (tokenAddress: string, to: string, amountRaw: string) =>
      castVote("transfer", [strip0x(to), String(amountRaw)], tokenAddress),
    [castVote]
  );

  return {
    enableMultisig,
    setLogic,
    initializeSigners,
    lockToSelf,
    addSigner,
    removeSigner,
    swapSigner,
    setDefaultThreshold,
    castVote,
    dismissIssue,
    proposeTransfer,
  };
}

export { strip0x, ZERO_ADDRESS };

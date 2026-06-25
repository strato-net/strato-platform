// Event watchers, run on a chrome.alarms schedule by the background worker. Each
// poll fetches current on-chain state for EVERY account in the wallet (HD,
// imported, and OAuth/remote), diffs it against persisted "seen" state, and fires
// notifications only on transitions. On the very first run we seed the seen-state
// WITHOUT notifying, so a fresh install doesn't dump a backlog of historical
// bridges/transfers as alerts.
//
// All reads are unauthenticated (Cirrus + eth_call), so watchers work even while
// the wallet is locked — we only need account addresses, which live in storage.

import { storage } from "wxt/storage";
import { keyring, type AccountMeta } from "./keyring";
import {
  getNetworks,
  getSelectedNetwork,
  isStratoNetwork,
  nativeSymbol,
  type StratoNetwork,
} from "./networks";
import { fetchBridgeHistory } from "./bridge";
import { fetchActivity } from "./activity";
import { fetchEvmActivity } from "./evm-portfolio";
import { fetchLoanHealth, HEALTH_SCALE } from "./lending";
import { fetchCdpPositions } from "./cdp";
import { pushNotification } from "./notifications";

type LoanBucket = "safe" | "warning" | "danger";

interface WatcherState {
  /**
   * Seed-schema version. When this changes (e.g. the scan scope was expanded to
   * all accounts), we re-seed silently so existing accounts' historical events
   * aren't replayed as a backlog of notifications.
   */
  version?: number;
  /** Bridge item keys (address-scoped) already seen at a terminal status. */
  bridgeTerminal: string[];
  /** Incoming transfer keys (address+network+hash) already seen. */
  incomingSeen: string[];
  /** Last NOTIFIED liquidation-risk bucket, per position key (loan / CDP). */
  loanBucket: Record<string, LoanBucket>;
  /** Last OBSERVED bucket, per position key — used to debounce transient reads. */
  observedBucket?: Record<string, LoanBucket>;
}

// Bump when the watched scope changes so the next run re-seeds without notifying.
const SEED_VERSION = 2;

const stateStore = storage.defineItem<WatcherState>("local:watcherState", {
  fallback: { bridgeTerminal: [], incomingSeen: [], loanBucket: {}, observedBucket: {} },
});

// Warn when (normalized) health factor drops below 1.2x the liquidation
// threshold; danger once at/below it (liquidatable).
const WARN_AT = (HEALTH_SCALE * 12n) / 10n;
const RANK: Record<LoanBucket, number> = { safe: 0, warning: 1, danger: 2 };

let running = false;

function shortAddr(a: string): string {
  const s = a.startsWith("0x") ? a : `0x${a}`;
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** Map a 1e18-scaled health factor (1e18 = liquidation threshold) to a bucket. */
function bucketFor(hf: bigint): LoanBucket {
  return hf < HEALTH_SCALE ? "danger" : hf < WARN_AT ? "warning" : "safe";
}

/**
 * Decide whether a liquidation-risk reading should fire, with a debounce: only
 * alert when the risk WORSENS past what the user was last told AND the same (or
 * worse) level was already seen on the previous poll. This filters out transient
 * bad reads — e.g. a momentarily stale CDP price oracle that makes a healthy
 * position (CR 3.04) briefly look risky for a single poll.
 */
function evalRisk(
  current: LoanBucket,
  notified: LoanBucket,
  observed: LoanBucket
): { fire: LoanBucket | null; nextNotified: LoanBucket } {
  const sustained = current !== "safe" && RANK[current] > RANK[notified] && RANK[observed] >= RANK[current];
  if (sustained) return { fire: current, nextNotified: current };
  // Re-arm downward (so a later rise alerts again); otherwise keep the baseline.
  return { fire: null, nextNotified: RANK[current] < RANK[notified] ? current : notified };
}

/** Fire a loan/CDP liquidation-risk notification (shared "loan" type + toggle). */
function fireRiskNotif(
  acct: AccountMeta,
  net: StratoNetwork,
  level: LoanBucket,
  key: string,
  kind: "loan" | "cdp",
  symbol?: string
): void {
  const noun = kind === "cdp" ? "CDP" : "Loan";
  const what = kind === "cdp" ? `${symbol || "collateral"} CDP` : "loan";
  const danger = level === "danger";
  pushNotification(
    {
      type: "loan",
      title: `${acct.label} · ${noun} ${danger ? "at liquidation risk" : "health is low"}`,
      body: danger
        ? `Your ${what} on ${net.name} is below the liquidation threshold. Add collateral or repay to avoid liquidation.`
        : `Your ${what} on ${net.name} is approaching the liquidation threshold. Consider adding collateral or repaying.`,
      route: "",
      address: acct.address,
    },
    `${key}-${level}-${Date.now()}`
  );
}

/** One polling pass across all watchers for every account in the wallet. */
export async function runWatchers(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const accounts = await keyring.getAccounts();
    if (!accounts.length) return;

    const state = await stateStore.getValue();
    // Re-seed silently on a fresh install OR when the seed version changes.
    const firstRun = state.version !== SEED_VERSION;
    const networks = await getNetworks();
    const strato = networks.find(isStratoNetwork);
    const selected = await getSelectedNetwork();
    const chainName = (id: string) =>
      networks.find((n) => n.chainId === id)?.name ?? `chain ${id}`;

    // Incoming transfers are watched on the home STRATO chain plus whatever chain
    // is currently selected (deduped) — across every account.
    const incomingNets: StratoNetwork[] = [];
    for (const n of [strato, selected]) {
      if (n && !incomingNets.some((x) => x.id === n.id)) incomingNets.push(n);
    }
    // Loans live on STRATO chains; check the home + active STRATO chains so a loan
    // on whichever chain you're using is caught.
    const stratoNets = incomingNets.filter(isStratoNetwork);

    // Snapshot the pre-run seen-sets; watchers decide notify-vs-seed against these
    // and RETURN newly-seen keys, which we merge once at the end (no shared-state
    // races between the concurrent tasks).
    const bridgeSeen = new Set(state.bridgeTerminal);
    const incomingSeen = new Set(state.incomingSeen);
    const observed = state.observedBucket ?? {};

    const bridgeTasks = accounts.map((a) =>
      watchBridge(a, strato, bridgeSeen, firstRun, chainName)
    );
    const incomingTasks = accounts.flatMap((a) =>
      incomingNets.map((n) => watchIncoming(a, n, incomingSeen, firstRun))
    );
    const loanTasks = accounts.flatMap((a) =>
      stratoNets.map((net) => {
        const key = `${net.id}:${a.address.toLowerCase()}`;
        return watchLoan(a, net, state.loanBucket[key] ?? "safe", observed[key] ?? "safe");
      })
    );
    // CDPs (per engine + collateral asset) — the more common borrowing route.
    const cdpTasks = accounts.flatMap((a) =>
      stratoNets.map((net) => watchCdp(a, net, state.loanBucket, observed))
    );

    const [bridgeRes, incomingRes, loanRes, cdpRes] = await Promise.all([
      Promise.allSettled(bridgeTasks),
      Promise.allSettled(incomingTasks),
      Promise.allSettled(loanTasks),
      Promise.allSettled(cdpTasks),
    ]);

    for (const r of bridgeRes) if (r.status === "fulfilled") for (const k of r.value) bridgeSeen.add(k);
    for (const r of incomingRes) if (r.status === "fulfilled") for (const k of r.value) incomingSeen.add(k);
    const applyRisk = (u: { key: string; notified: LoanBucket; observed: LoanBucket }) => {
      state.loanBucket[u.key] = u.notified;
      observed[u.key] = u.observed;
    };
    for (const r of loanRes) if (r.status === "fulfilled") applyRisk(r.value);
    for (const r of cdpRes) if (r.status === "fulfilled") for (const u of r.value) applyRisk(u);

    state.bridgeTerminal = [...bridgeSeen].slice(-500);
    state.incomingSeen = [...incomingSeen].slice(-500);
    state.observedBucket = observed;
    state.version = SEED_VERSION;
    await stateStore.setValue(state);
  } finally {
    running = false;
  }
}

async function watchBridge(
  acct: AccountMeta,
  strato: StratoNetwork | undefined,
  prevSeen: Set<string>,
  firstRun: boolean,
  chainName: (id: string) => string
): Promise<string[]> {
  if (!strato) return [];
  const items = await fetchBridgeHistory(strato, acct.address);
  const found: string[] = [];
  for (const it of items) {
    if (it.status !== "completed" && it.status !== "failed") continue;
    const key = `${acct.address.toLowerCase()}:${it.direction}-${it.timestamp}-${it.stratoToken}-${it.amount}-${it.status}`;
    found.push(key);
    if (prevSeen.has(key) || firstRun) continue;
    const dir = it.direction === "out" ? "out to" : "in from";
    pushNotification(
      {
        type: "bridge",
        title: `${acct.label} · Bridge ${it.status === "completed" ? "complete" : "failed"}`,
        body:
          it.status === "completed"
            ? `Bridged ${it.amount} ${it.symbol} ${dir} ${chainName(it.externalChainId)}.`
            : `Bridge of ${it.amount} ${it.symbol} ${dir} ${chainName(it.externalChainId)} failed.`,
        route: "bridges",
        address: acct.address,
      },
      key
    );
  }
  return found;
}

async function watchIncoming(
  acct: AccountMeta,
  network: StratoNetwork,
  prevSeen: Set<string>,
  firstRun: boolean
): Promise<string[]> {
  const acts = isStratoNetwork(network)
    ? await fetchActivity(network, acct.address, 25)
    : await fetchEvmActivity(network.chainId, acct.address, nativeSymbol(network));
  const found: string[] = [];
  for (const a of acts) {
    if (a.direction !== "in" || !a.hash) continue;
    const key = `${acct.address.toLowerCase()}:${network.id}:${a.hash}`;
    found.push(key);
    if (prevSeen.has(key) || firstRun) continue;
    pushNotification(
      {
        type: "incoming",
        title: `${acct.label} · Tokens received`,
        body: `Received ${a.amount} ${a.symbol} from ${shortAddr(a.counterparty)} on ${network.name}.`,
        route: "",
        address: acct.address,
      },
      key
    );
  }
  return found;
}

type RiskUpdate = { key: string; notified: LoanBucket; observed: LoanBucket };

async function watchLoan(
  acct: AccountMeta,
  net: StratoNetwork,
  notified: LoanBucket,
  observed: LoanBucket
): Promise<RiskUpdate> {
  const key = `${net.id}:${acct.address.toLowerCase()}`;
  const health = await fetchLoanHealth(net, acct.address);
  const current: LoanBucket = !health || !health.hasDebt ? "safe" : bucketFor(health.healthFactor);
  const { fire, nextNotified } = evalRisk(current, notified, observed);
  if (fire) fireRiskNotif(acct, net, fire, key, "loan");
  return { key, notified: nextNotified, observed: current };
}

async function watchCdp(
  acct: AccountMeta,
  net: StratoNetwork,
  notifiedMap: Record<string, LoanBucket>,
  observedMap: Record<string, LoanBucket>
): Promise<RiskUpdate[]> {
  const positions = await fetchCdpPositions(net, acct.address);
  return positions.map((p) => {
    const key = `cdp:${net.id}:${p.engine.toLowerCase()}:${p.asset}:${acct.address.toLowerCase()}`;
    const current = bucketFor(p.healthFactor);
    const { fire, nextNotified } = evalRisk(current, notifiedMap[key] ?? "safe", observedMap[key] ?? "safe");
    if (fire) fireRiskNotif(acct, net, fire, key, "cdp", p.symbol);
    return { key, notified: nextNotified, observed: current };
  });
}

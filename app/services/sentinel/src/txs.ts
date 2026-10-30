import { Config } from "./config";
import { Alert } from "./rules";
import { chunk, stratoApi } from "./strato";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [txs] ${msg}`);

/** SolidVM's rejection of the constructor re-call exploit (fixed 24 Oct) */
const CONSTRUCTOR_CALL = "constructor cannot be called on a deployed contract";

/** revert messages meaning "caller lacks permission" — Ownable, AdminRegistry, bridge/vault guards */
const ACCESS_DENIED = [
  "does not match sender",
  "OwnableUnauthorizedAccount",
  "Only an admin or a whitelisted account",
  "Cannot forge a vote",
  "Only registered network admins",
  "Only the staking contract",
  "not whitelisted",
  "only owner",
  "Only engine",
  "only LendingPool",
  "caller is not",
  "unauthorized",
];

/** bounds one catch-up step after downtime */
const MAX_BLOCKS = 2000;

interface Tx {
  hash: string;
  from: string;
  to?: string;
  funcName?: string;
  blockNumber: number;
}

async function scanRange(cfg: Config, from: number, to: number): Promise<{ alerts: Alert[]; txs: number; failed: number }> {
  const txs: Tx[] = [];
  for (let offset = 0; ; offset += cfg.pageSize) {
    const page = await stratoApi<Tx[]>(
      cfg,
      `/transaction?minblocknumber=${from}&maxblocknumber=${to}&limit=${cfg.pageSize}&offset=${offset}`
    );
    txs.push(...page);
    if (page.length < cfg.pageSize) break;
  }

  const results: Record<string, { status: unknown; message: string }[]> = {};
  for (const part of chunk(txs.map((t) => t.hash), 250))
    Object.assign(results, await stratoApi(cfg, "/transactionResult/batch", part));

  // one alert per (sender, contract, message) so a retry loop does not flood the channel
  const grouped = new Map<string, Alert & { count: number }>();
  const failuresBySender = new Map<string, number>();
  for (const t of txs) {
    const r = results[t.hash]?.[0];
    if (!r || r.status === "success") continue;
    failuresBySender.set(t.from, (failuresBySender.get(t.from) || 0) + 1);

    const severity = r.message.includes(CONSTRUCTOR_CALL)
      ? "critical"
      : ACCESS_DENIED.some((m) => r.message.includes(m))
        ? "high"
        : null;
    if (!severity) continue;
    const key = `${t.from}|${t.to}|${r.message}`;
    const g = grouped.get(key);
    if (g) {
      g.count++;
      continue;
    }
    grouped.set(key, {
      severity,
      title: severity === "critical" ? "Constructor call on a deployed contract" : "Permission-denied transaction",
      fields: { sender: t.from, contract: t.to, function: t.funcName, message: r.message, tx: t.hash, block: t.blockNumber },
      count: 1,
    });
  }

  const alerts: Alert[] = [...grouped.values()].map(({ count, ...a }) => ({ ...a, fields: { ...a.fields, count } }));
  for (const [sender, count] of failuresBySender)
    if (count >= cfg.failBurst)
      alerts.push({ severity: "high", title: "Burst of failed transactions", fields: { sender, count, blocks: `${from}-${to}` } });
  const failed = [...failuresBySender.values()].reduce((n, c) => n + c, 0);
  return { alerts, txs: txs.length, failed };
}

/** Failed transactions never reach Cirrus events, so read them from strato-api by block range. */
export async function scanTxs(cfg: Config, store: StateStore): Promise<void> {
  const s = store.state;
  const [last] = await stratoApi<{ blockData: { number: number } }[]>(cfg, "/block/last/1");
  const head = last.blockData.number;
  if (s.lastTxBlock === undefined) {
    s.lastTxBlock = head;
    store.save();
    log(`no cursor; starting from block ${head}`);
    return;
  }

  if (s.lastTxBlock >= head) log(`no new blocks after ${s.lastTxBlock}`);
  while (s.lastTxBlock < head) {
    const from = s.lastTxBlock + 1;
    const to = Math.min(head, from + MAX_BLOCKS - 1);
    const { alerts, txs, failed } = await scanRange(cfg, from, to);
    await notify(cfg, alerts);
    s.lastTxBlock = to;
    store.save();
    log(`scanned blocks ${from}-${to}: ${txs} tx(s), ${failed} failed — ${alerts.length} alert(s)`);
  }
}

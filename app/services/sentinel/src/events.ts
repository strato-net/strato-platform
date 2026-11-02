import { ADMIN_REGISTRY, Config, MERCATA_BRIDGE, isZeroAddress } from "./config";
import { Alert, CirrusEvent, MINT_CAP_EVENTS, contractLabel, evaluate, eventFields, short, units } from "./rules";
import { cirrus, chunk, stratoApi } from "./strato";
import { bridgeFilter, checkBridge } from "./bridge";
import { notify } from "./notify";
import { StateStore } from "./state";

const log = (msg: string) => console.log(`${new Date().toISOString()} [events] ${msg}`);

const SELECT =
  "id,address,contract_name,event_name,attributes,block_number,block_timestamp,transaction_hash,transaction_sender";
const ZERO = "(0,0000000000000000000000000000000000000000)";

/** only the events the rules look at — ownership, AdminRegistry, mints, mint caps, and bridge flows */
const filter = (cfg: Config) =>
  `(event_name.eq.OwnershipTransferred,address.eq.${ADMIN_REGISTRY},` +
  `and(event_name.eq.Transfer,attributes->>from.in.${ZERO}),` +
  `event_name.in.(${MINT_CAP_EVENTS.join(",")}),${bridgeFilter(cfg)})`;

const txKey = (hash: string, address: string) => `${hash}:${address}`;
const unique = (xs: string[]) => [...new Set(xs)];

/** (tx, contract) pairs where the contract was deployed in that tx — factories and UserRegistry
 *  deploy a contract and hand its ownership on in the same tx */
async function deployedInTx(cfg: Config, events: CirrusEvent[]): Promise<Set<string>> {
  const born = new Set<string>();
  for (const part of chunk(unique(events.map((e) => e.transaction_hash)), 250)) {
    const results: Record<string, { contractsCreated?: string[] }[]> = await stratoApi(cfg, "/transactionResult/batch", part);
    for (const [hash, [r]] of Object.entries(results))
      for (const address of r?.contractsCreated || []) born.add(txKey(hash, address));
  }
  return born;
}

/** An owner change outside deployment re-assigns a live contract — the exploit pattern.
 *  previousOwner == newOwner is a no-op (seen in deployment helpers) and is skipped. */
async function checkOwnership(cfg: Config, events: CirrusEvent[]): Promise<Alert[]> {
  const changes = events.filter(
    (e) =>
      e.event_name === "OwnershipTransferred" &&
      !isZeroAddress(e.attributes.previousOwner) &&
      e.attributes.previousOwner !== e.attributes.newOwner
  );
  if (changes.length === 0) return [];
  const born = await deployedInTx(cfg, changes);
  return changes
    .filter((e) => !born.has(txKey(e.transaction_hash, e.address)))
    .map((e) => ({
      severity: "critical",
      title:
        `Owner of ${contractLabel(e)} changed from ${short(e.attributes.previousOwner)} to ` +
        `${short(e.attributes.newOwner)} (tx sender ${short(e.transaction_sender)})`,
      fields: eventFields(e),
    }));
}

/** Token and Voucher mint is onlyOwner; with AdminRegistry as owner every mint must come
 *  through an IssueExecuted(mint) in the same tx. ERC721 mints (tokenId) are public and skipped,
 *  as are zero-amount mints. */
async function checkMints(cfg: Config, events: CirrusEvent[]): Promise<Alert[]> {
  const mints = events.filter((e) => e.event_name === "Transfer" && Number(e.attributes.value) > 0);
  if (mints.length === 0) return [];

  const supply = new Map<string, number>();
  const symbols = new Map<string, string>();
  for (const table of ["BlockApps-Token", "BlockApps-Voucher"]) {
    for (const part of chunk(unique(mints.map((e) => e.address)), 50)) {
      const rows = await cirrus(cfg, `/${table}`, {
        address: `in.(${part.join(",")})`,
        _owner: `eq.${ADMIN_REGISTRY}`,
        select: "address,_totalSupply,_symbol",
      });
      for (const r of rows) {
        supply.set(r.address, Number(r._totalSupply));
        symbols.set(r.address, r._symbol);
      }
    }
  }
  const governed = mints.filter((e) => supply.has(e.address));
  if (governed.length === 0) return [];

  const approved = new Set<string>();
  for (const part of chunk(unique(governed.map((e) => e.transaction_hash)), 50)) {
    const rows = await cirrus(cfg, "/event", {
      address: `eq.${ADMIN_REGISTRY}`,
      event_name: "eq.IssueExecuted",
      "attributes->>func": "eq.mint",
      transaction_hash: `in.(${part.join(",")})`,
      select: "transaction_hash,attributes->>target",
    });
    for (const r of rows) approved.add(txKey(r.transaction_hash, r.target));
  }
  // a token's initial supply is minted by its factory in the deploying tx
  const born = await deployedInTx(cfg, governed);

  const alerts: Alert[] = [];
  for (const e of governed) {
    const key = txKey(e.transaction_hash, e.address);
    if (born.has(key)) continue;
    const minted = `${units(e.attributes.value)} ${symbols.get(e.address) || short(e.address)} to ${short(e.attributes.to)}`;
    if (!approved.has(key)) {
      alerts.push({
        severity: "critical",
        title: `Mint of ${minted} without a governance vote (tx sender ${short(e.transaction_sender)})`,
        fields: eventFields(e),
      });
      continue;
    }
    const pct = (Number(e.attributes.value) / supply.get(e.address)!) * 100;
    if (pct >= cfg.mintAlertPct)
      alerts.push({ severity: "high", title: `Large governance mint of ${minted}: ${pct.toFixed(1)}% of supply`, fields: eventFields(e) });
  }
  return alerts;
}

/** Read every matching event after the cursor, alert, then advance the cursor.
 *  The cursor only moves after Slack accepts, so a failed post is retried next cycle. */
export async function scanEvents(cfg: Config, store: StateStore): Promise<void> {
  const s = store.state;
  // first start: begin at the newest event instead of replaying history
  if (s.lastEventId === undefined) {
    const [head] = await cirrus(cfg, "/event", { order: "id.desc", limit: 1, select: "id" });
    s.lastEventId = head?.id ?? 0;
    store.save();
    log(`no cursor; starting from event id ${s.lastEventId}`);
  }

  for (;;) {
    const page = await cirrus<CirrusEvent>(cfg, "/event", {
      id: `gt.${s.lastEventId}`,
      or: filter(cfg),
      order: "id.asc",
      limit: cfg.pageSize,
      select: SELECT,
    });
    if (page.length === 0) {
      log(`no new events after id ${s.lastEventId}`);
      break;
    }

    const alerts = [
      ...page.map((e) => evaluate(cfg, e)).filter((a): a is Alert => a !== null),
      ...(await checkOwnership(cfg, page)),
      ...(await checkMints(cfg, page)),
      ...(await checkBridge(cfg, page)),
    ];
    await notify(cfg, alerts);
    s.lastEventId = page[page.length - 1].id;
    store.save();
    const count = (name: string) => page.filter((e) => e.event_name === name).length;
    log(
      `scanned ${page.length} event(s) up to id ${s.lastEventId}: ` +
        `${page.filter((e) => e.address === ADMIN_REGISTRY).length} AdminRegistry, ` +
        `${count("OwnershipTransferred")} ownership, ${count("Transfer")} mint(s), ` +
        `${page.filter((e) => MINT_CAP_EVENTS.includes(e.event_name)).length} mint-cap, ` +
        `${page.filter((e) => e.address === MERCATA_BRIDGE || e.address === cfg.stratoNativeBridge).length} bridge — ${alerts.length} alert(s)`
    );
    if (page.length < cfg.pageSize) break;
  }
}

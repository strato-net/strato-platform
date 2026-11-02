import { ADMIN_REGISTRY, Config, Severity } from "./config";

export interface CirrusEvent {
  id: number;
  address: string;
  event_name: string;
  attributes: Record<string, any>;
  block_number: string;
  block_timestamp: string;
  transaction_hash: string;
  transaction_sender: string;
  contract_name?: string;
}

export interface Alert {
  severity: Severity;
  title: string;
  fields: Record<string, unknown>;
}

/** 0x1c2d…b427 — enough to recognise an address in a title */
export const short = (a?: string) => {
  const n = String(a ?? "").replace(/^0x/, "");
  return /^[0-9a-fA-F]{40}$/.test(n) ? `0x${n.slice(0, 4)}…${n.slice(-4)}` : String(a);
};

/** 18-decimal token amount, readable */
export const units = (v: unknown) => (Number(v) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 4 });

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** "key=value, …" with short addresses and 18-decimal integers in units (27-decimal RAY rates stay raw),
 *  capped so titles stay short */
export const brief = (attrs: Record<string, unknown>) =>
  cap(
    Object.entries(attrs)
      .map(([k, v]) => `${k}=${/^\d{16,27}$/.test(String(v)) ? units(v) : short(String(v))}`)
      .join(", "),
    200
  );

/** "CDPEngine 0x0000…1011" */
export const contractLabel = (e: CirrusEvent) => `${e.contract_name ? `${e.contract_name} ` : ""}${short(e.address)}`;

export const eventFields = (e: CirrusEvent) => ({
  contract: `${e.contract_name || "?"} (${e.address})`,
  event: e.event_name,
  sender: e.transaction_sender,
  block: `${e.block_number} · ${e.block_timestamp}`,
  tx: e.transaction_hash,
  attributes: JSON.stringify(e.attributes),
});

/** AdminRegistry functions that change who governs, and how. Matched on the function an
 *  IssueExecuted ran: deployed registries do not reliably emit AdminAdded / WhitelistGranted / … */
const GOVERNANCE: Record<string, Severity> = {
  _addAdmin: "critical",
  _removeAdmin: "critical",
  _swapAdmin: "critical",
  setVotingThreshold: "critical",
  setDefaultVotingThresholdBps: "critical",
  addWhitelist: "high",
  createContract: "high",
  createSaltedContract: "high",
  removeWhitelist: "info",
};

/** events that change how much a minter may create: CDP debt ceiling, PSM, MetalForge, FlashMint */
export const MINT_CAP_EVENTS = ["CollateralConfigured", "MintConfigSet", "MetalConfigUpdated", "MintCapUpdated", "MaxLoanSet"];

/** Map one AdminRegistry or mint-cap event to an alert, or null when it is expected activity. */
export function evaluate(cfg: Config, e: CirrusEvent): Alert | null {
  const alert = (severity: Severity, title: string): Alert => ({ severity, title, fields: eventFields(e) });
  if (MINT_CAP_EVENTS.includes(e.event_name))
    return alert("high", `Mint cap changed on ${contractLabel(e)} (${e.event_name}): ${brief(e.attributes)}`);
  if (e.address !== ADMIN_REGISTRY) return null;

  const { executor, creator, func, target, args } = e.attributes;
  const call = `${func} on ${short(target)} (args ${cap(String(args), 120)})`;
  if (e.event_name === "IssueCreated") return alert("info", `Governance vote created by ${short(creator)}: ${call}`);
  if (e.event_name !== "IssueExecuted") return null;

  const governance = target === ADMIN_REGISTRY ? GOVERNANCE[func] : undefined;
  if (governance) return alert(governance, `AdminRegistry ${func} executed by ${short(executor)} (args ${cap(String(args), 120)})`);
  return cfg.knownExecutors[executor]?.has(func) ? null : alert("high", `Unlisted executor ${short(executor)} ran ${call} through governance`);
}

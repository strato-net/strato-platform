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
}

export interface Alert {
  severity: Severity;
  title: string;
  fields: Record<string, unknown>;
}

export const eventFields = (e: CirrusEvent) => ({
  contract: e.address,
  event: e.event_name,
  sender: e.transaction_sender,
  block: `${e.block_number} · ${e.block_timestamp}`,
  tx: e.transaction_hash,
  attributes: JSON.stringify(e.attributes),
});

/** AdminRegistry events that change who governs, and how */
const GOVERNANCE: Record<string, Severity> = {
  AdminAdded: "critical",
  AdminRemoved: "critical",
  AdminSwapped: "critical",
  VotingThresholdSet: "critical",
  DefaultVotingThresholdSet: "critical",
  WhitelistGranted: "high",
  ContractCreated: "high",
  WhitelistRevoked: "info",
  IssueCreated: "info",
};

/** events that change how much a minter may create: CDP debt ceiling, PSM, MetalForge, FlashMint */
export const MINT_CAP_EVENTS = ["CollateralConfigured", "MintConfigSet", "MetalConfigUpdated", "MintCapUpdated", "MaxLoanSet"];

/** Map one AdminRegistry or mint-cap event to an alert, or null when it is expected activity. */
export function evaluate(cfg: Config, e: CirrusEvent): Alert | null {
  const alert = (severity: Severity, title: string): Alert => ({ severity, title, fields: eventFields(e) });
  if (MINT_CAP_EVENTS.includes(e.event_name)) return alert("high", `Mint cap changed: ${e.event_name}`);
  if (e.address !== ADMIN_REGISTRY) return null;

  if (e.event_name === "IssueExecuted") {
    const executor = e.attributes.executor;
    const func = e.attributes.func;
    return cfg.knownExecutors[executor]?.has(func)
      ? null
      : alert("high", `AdminRegistry executed ${func} by unlisted executor`);
  }

  const severity = GOVERNANCE[e.event_name];
  return severity ? alert(severity, `AdminRegistry ${e.event_name}`) : null;
}

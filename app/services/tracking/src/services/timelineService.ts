import { query } from "../db/pool";
import {
  ActivitySummary,
  AttributionSnapshot,
  countByCategory,
  getSnapshot,
  toBridgeInItem,
} from "./attributionService";
import { ActivityCategory } from "./cirrusService";
import { fetchRemoteChainTxs, remoteChainEnabled, RemoteChainTx } from "./etherscanService";
import { externalChain, externalChainName, externalTxUrl } from "../utils/chains";

// Per-user activity timeline: the off-chain story this service records (link
// opens, engagement, wallet connections) merged with the on-chain story Cirrus
// knows (bridge-ins, swaps, CDP, savings, transfers, …) and — when an
// Etherscan-compatible API key is configured — the origin-chain transactions
// that preceded the bridge. Read-only: no new tables, no new columns.

export type TimelineKind =
  | "link_opened"
  | "engaged"
  | "wallet_connected"
  | "bridge_in"
  | "onchain"
  | "remote_chain";

export interface TimelineItem {
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  // Set for on-chain items so the dashboard can reuse its category labels
  category: ActivityCategory | null;
  address: string | null;
  linkId: string | null;
  linkLabel: string | null;
  linkSource: string | null;
  // STRATO transaction (explorer link built by the dashboard)
  txHash: string | null;
  chainId: number | null;
  chainName: string | null;
  externalTxHash: string | null;
  externalTxUrl: string | null;
  amount: string | null;
  amountUsd: number | null;
  // Link this chain event is attributed to (null when outside any window)
  attributedLinkId: string | null;
}

export interface TimelineLink {
  id: string;
  slug: string;
  label: string;
  source: string;
  fullSource: string;
}

export interface UserTimeline {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  firstSeenAt: string;
  lastActivityAt: string | null;
  links: TimelineLink[];
  activitySummary: ActivitySummary;
  // false when TRACKING_ETHERSCAN_API_KEY is unset: origin-chain items are
  // then absent by configuration, not because the wallet has no history
  remoteChainEnabled: boolean;
  items: TimelineItem[];
}

interface ConnectionRow {
  id: string;
  session_id: string;
  link_id: string;
  external_wallet_address: string;
  strato_address: string;
  connector: string | null;
  connected_at: Date;
}

interface SessionRow {
  id: string;
  link_id: string;
  opened_at: Date;
  engaged_at: Date | null;
  referrer: string | null;
  geo_city: string | null;
  geo_country: string | null;
}

const emptyItem = (kind: TimelineKind, at: Date, title: string): TimelineItem => ({
  kind,
  at: at.toISOString(),
  title,
  detail: null,
  category: null,
  address: null,
  linkId: null,
  linkLabel: null,
  linkSource: null,
  txHash: null,
  chainId: null,
  chainName: null,
  externalTxHash: null,
  externalTxUrl: null,
  amount: null,
  amountUsd: null,
  attributedLinkId: null,
});

const fetchConnections = async (addresses: string[]): Promise<ConnectionRow[]> => {
  const result = await query<ConnectionRow>(
    `SELECT wc.id, wc.session_id, wc.link_id, wc.external_wallet_address,
            wc.strato_address, wc.connector, wc.connected_at
     FROM wallet_connections wc
     JOIN tracking_sessions ts ON ts.id = wc.session_id
     WHERE NOT ts.is_bot_or_preview
       AND (wc.external_wallet_address = ANY($1) OR wc.strato_address = ANY($1))
     ORDER BY wc.connected_at ASC`,
    [addresses]
  );
  return result.rows;
};

// A visitor's external wallet and STRATO account are linked by the connection
// rows that carry both; follow those until the address set stops growing so
// the timeline covers the whole person, whichever address was clicked.
const resolveIdentity = async (
  address: string
): Promise<{ connections: ConnectionRow[]; addresses: string[] } | null> => {
  let addresses = [address];
  let connections = await fetchConnections(addresses);
  if (connections.length === 0) return null;
  for (let round = 0; round < 3; round++) {
    const known = new Set(addresses);
    for (const conn of connections) {
      if (conn.external_wallet_address) known.add(conn.external_wallet_address);
      if (conn.strato_address) known.add(conn.strato_address);
    }
    if (known.size === addresses.length) break;
    addresses = [...known];
    connections = await fetchConnections(addresses);
  }
  return { connections, addresses };
};

const fetchSessions = async (sessionIds: string[]): Promise<SessionRow[]> => {
  if (sessionIds.length === 0) return [];
  const result = await query<SessionRow>(
    `SELECT id, link_id, opened_at, engaged_at, referrer, geo_city, geo_country
     FROM tracking_sessions
     WHERE id = ANY($1::uuid[])
     ORDER BY opened_at ASC`,
    [sessionIds]
  );
  return result.rows;
};

const locationOf = (session: SessionRow): string | null => {
  const parts = [session.geo_city, session.geo_country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

const WEI = 10n ** 18n;

// Raw wei string -> short decimal string (remote-chain native values)
const formatWei = (raw: string): string => {
  try {
    const value = BigInt(raw);
    const whole = value / WEI;
    const fraction = (value % WEI).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "0";
  }
};

const remoteTxTitle = (tx: RemoteChainTx, addresses: Set<string>): string => {
  const chain = externalChain(tx.chainId);
  const symbol = chain?.nativeSymbol ?? "";
  const where = chain ? ` on ${chain.name}` : "";
  const amount = formatWei(tx.value);
  const outgoing = addresses.has(tx.from.replace(/^0x/, ""));
  if (amount !== "0") {
    return `${outgoing ? "Sent" : "Received"} ${amount} ${symbol}${where}`.replace(/\s+/g, " ");
  }
  return `${outgoing ? "Sent transaction" : "Received transaction"}${where}`;
};

// Origin-chain history for the external wallets that bridged in: the most
// recent transactions of each (chain, sender) pair, which is the part of the
// story explaining how the user funded their arrival on STRATO.
const remoteChainItems = async (
  origins: { chainId: number; sender: string; hashes: Set<string> }[],
  addresses: Set<string>
): Promise<TimelineItem[]> => {
  const items: TimelineItem[] = [];
  for (const origin of origins) {
    const txs = await fetchRemoteChainTxs(origin.chainId, origin.sender);
    for (const tx of txs) {
      if (origin.hashes.has(tx.hash.toLowerCase())) continue; // already shown as the bridge-in
      const item = emptyItem("remote_chain", new Date(tx.timestampMs), remoteTxTitle(tx, addresses));
      item.address = origin.sender;
      item.chainId = tx.chainId;
      item.chainName = externalChainName(tx.chainId);
      item.externalTxHash = tx.hash;
      item.externalTxUrl = externalTxUrl(tx.chainId, tx.hash);
      item.amount = formatWei(tx.value);
      item.detail = tx.failed
        ? "Failed transaction"
        : tx.functionName
          ? tx.functionName.split("(")[0]
          : tx.to
            ? `To ${tx.to}`
            : null;
      items.push(item);
    }
  }
  return items;
};

const offchainItems = (
  snapshot: AttributionSnapshot,
  connections: ConnectionRow[],
  sessions: SessionRow[]
): TimelineItem[] => {
  const linkById = new Map(snapshot.links.map((link) => [String(link.id), link]));
  const items: TimelineItem[] = [];

  const withLink = (item: TimelineItem, linkId: string): TimelineItem => {
    const link = linkById.get(String(linkId));
    item.linkId = String(linkId);
    item.linkLabel = link?.label ?? null;
    item.linkSource = link?.source ?? null;
    return item;
  };

  for (const session of sessions) {
    const opened = withLink(
      emptyItem("link_opened", session.opened_at, "Opened tracking link"),
      session.link_id
    );
    const location = locationOf(session);
    const referrer = session.referrer ? `via ${session.referrer}` : null;
    opened.detail = [location, referrer].filter(Boolean).join(" · ") || null;
    items.push(opened);

    if (session.engaged_at) {
      items.push(
        withLink(emptyItem("engaged", session.engaged_at, "Engaged with the app"), session.link_id)
      );
    }
  }

  for (const conn of connections) {
    const item = withLink(
      emptyItem("wallet_connected", conn.connected_at, "Connected wallet"),
      conn.link_id
    );
    item.address = conn.external_wallet_address || conn.strato_address;
    const parts = [
      conn.connector,
      conn.external_wallet_address && conn.strato_address
        ? `STRATO account ${conn.strato_address}`
        : null,
    ].filter(Boolean);
    item.detail = parts.length ? parts.join(" · ") : null;
    items.push(item);
  }

  return items;
};

export const getUserTimeline = async (address: string): Promise<UserTimeline | null> => {
  const identity = await resolveIdentity(address);
  if (!identity) return null;
  const { connections, addresses } = identity;
  const addressSet = new Set(addresses);

  const snapshot = await getSnapshot();
  const sessions = await fetchSessions([...new Set(connections.map((c) => c.session_id))]);

  const bridgeIns = snapshot.bridgeIns
    .filter((b) => addressSet.has(b.stratoRecipient) || addressSet.has(b.externalSender))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const activityEvents = snapshot.activityEvents
    .filter((e) => addressSet.has(e.userAddress))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const items: TimelineItem[] = offchainItems(snapshot, connections, sessions);

  for (const bridge of bridgeIns) {
    const detail = toBridgeInItem(snapshot, bridge);
    const item = emptyItem(
      "bridge_in",
      new Date(bridge.timestampMs),
      `Bridged in ${detail.amount} ${detail.asset}`
    );
    item.category = "bridge_in";
    item.address = detail.address;
    item.txHash = detail.txHash;
    item.chainId = detail.externalChainId;
    item.chainName = externalChainName(detail.externalChainId);
    item.externalTxHash = detail.externalTxHash;
    item.externalTxUrl = externalTxUrl(detail.externalChainId, detail.externalTxHash);
    item.amount = detail.amount;
    item.amountUsd = detail.amountUsd;
    item.detail = item.chainName ? `From ${item.chainName}` : null;
    item.attributedLinkId = snapshot.assignments.get(bridge.eventKey)?.linkId ?? null;
    items.push(item);
  }

  for (const event of activityEvents) {
    const item = emptyItem(
      "onchain",
      new Date(event.timestampMs),
      `${event.contractName}: ${event.eventName}`
    );
    item.category = event.category;
    item.address = event.userAddress;
    item.attributedLinkId = snapshot.assignments.get(event.eventKey)?.linkId ?? null;
    items.push(item);
  }

  // Origin-chain enrichment: one lookup per (chain, external sender) pair
  const origins = new Map<string, { chainId: number; sender: string; hashes: Set<string> }>();
  for (const bridge of bridgeIns) {
    if (bridge.externalChainId == null || !bridge.externalSender) continue;
    const key = `${bridge.externalChainId}:${bridge.externalSender}`;
    const origin = origins.get(key) ?? {
      chainId: bridge.externalChainId,
      sender: bridge.externalSender,
      hashes: new Set<string>(),
    };
    if (bridge.externalTxHash) origin.hashes.add(bridge.externalTxHash.toLowerCase());
    origins.set(key, origin);
  }
  items.push(...(await remoteChainItems([...origins.values()], addressSet)));

  items.sort((a, b) => b.at.localeCompare(a.at));

  const linkIds = [...new Set(connections.map((c) => String(c.link_id)))];
  const links: TimelineLink[] = snapshot.links
    .filter((link) => linkIds.includes(String(link.id)))
    .map((link) => ({
      id: String(link.id),
      slug: link.slug,
      label: link.label,
      source: link.source ?? "",
      fullSource: link.full_source ?? "",
    }));

  const first = connections[0];
  const chainTimestamps = [
    ...bridgeIns.map((b) => b.timestampMs),
    ...activityEvents.map((e) => e.timestampMs),
  ].filter(Number.isFinite);

  return {
    address,
    addresses,
    externalWalletAddress:
      connections.find((c) => c.external_wallet_address)?.external_wallet_address ?? null,
    stratoAddress: connections.find((c) => c.strato_address)?.strato_address ?? null,
    connector: connections.find((c) => c.connector)?.connector ?? null,
    firstSeenAt: (sessions[0]?.opened_at ?? first.connected_at).toISOString(),
    lastActivityAt: chainTimestamps.length
      ? new Date(Math.max(...chainTimestamps)).toISOString()
      : null,
    links,
    activitySummary: countByCategory(activityEvents, bridgeIns.length),
    remoteChainEnabled: remoteChainEnabled(),
    items,
  };
};

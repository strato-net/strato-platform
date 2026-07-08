import {
  NormalizedWithdrawalAudit,
  WithdrawalAuditStatusGroup,
} from "@mercata/shared-types";
import {
  CirrusClient,
  CirrusEventRow,
  CirrusMappingRow,
  TraceCursor,
  TraceEdge,
  TraceLot,
  TrustAnchor,
  WasConfig,
  WithdrawalCandidateRepository,
} from "./types";

const STANDARD_WITHDRAWALS_TABLE = "/BlockApps-MercataBridge-withdrawals";
const NATIVE_WITHDRAWALS_TABLE = "/BlockApps-StratoNativeBridge-withdrawals";
const EVENT_TABLE = "/event";
const WITHDRAWAL_SELECT = "key,value,block_timestamp";
const EVENT_SELECT =
  "event_name,address,attributes,block_timestamp,block_number,transaction_hash,transaction_sender";
const PROTOCOL_EVENT_NAMES = [
  "Swap",
  "MetalMinted",
  "USDSTMinted",
  "DirectPSMMinted",
  "RewardsClaimed",
];

interface StandardWithdrawalValue {
  bridgeStatus: string | number;
  custodyTxHash?: string;
  externalChainId: string | number;
  externalRecipient: string;
  externalToken?: string;
  externalTokenAmount?: string;
  requestedAt?: string;
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp?: string;
}

interface NativeWithdrawalValue {
  bridgeStatus: string | number;
  externalTxHash?: string;
  externalChainId: string | number;
  externalBridge?: string;
  externalRecipient: string;
  representationToken?: string;
  externalTokenAmount?: string;
  requestedAt?: string;
  stratoSender: string;
  stratoToken: string;
  stratoTokenAmount: string;
  timestamp?: string;
  nativeMintProposalHash?: string;
}

type StandardWithdrawalRow = CirrusMappingRow<StandardWithdrawalValue>;
type NativeWithdrawalRow = CirrusMappingRow<NativeWithdrawalValue>;

const statusFilterFor = (statusGroup: WithdrawalAuditStatusGroup): string => {
  if (statusGroup === "initiated") return "eq.1";
  if (statusGroup === "pending-review") return "eq.2";
  if (statusGroup === "complete") return "eq.3";
  if (statusGroup === "aborted") return "eq.4";
  return "eq.1";
};

const asString = (value: string | number | boolean | undefined): string =>
  value === undefined ? "" : String(value);

const normalizeAddress = (address: string): string =>
  address.toLowerCase().replace(/^0x/, "");

const eventAttribute = (
  event: CirrusEventRow,
  key: string,
): string | undefined => {
  const value = event.attributes[key];
  return value === undefined ? undefined : String(value);
};

const toBigInt = (value: string | number | undefined): bigint | undefined => {
  if (value === undefined || value === "") return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

const normalizedEventAttribute = (
  event: CirrusEventRow,
  key: string,
): string | undefined => {
  const value = eventAttribute(event, key);
  return value ? normalizeAddress(value) : undefined;
};

const eventAmountEquals = (
  event: CirrusEventRow,
  key: string,
  amount: bigint,
): boolean => toBigInt(eventAttribute(event, key)) === amount;

const matchesProtocolOutput = (
  protocolEvent: CirrusEventRow,
  transferEvent: CirrusEventRow,
  cursor: TraceCursor,
): boolean => {
  const transferAmount = toBigInt(eventAttribute(transferEvent, "value"));
  if (transferAmount === undefined) return false;

  const owner = normalizeAddress(cursor.owner);
  const token = normalizeAddress(cursor.token);

  if (protocolEvent.event_name === "Swap") {
    return (
      normalizedEventAttribute(protocolEvent, "sender") === owner &&
      normalizedEventAttribute(protocolEvent, "tokenOut") === token &&
      eventAmountEquals(protocolEvent, "amountOut", transferAmount)
    );
  }

  if (protocolEvent.event_name === "MetalMinted") {
    return (
      normalizedEventAttribute(protocolEvent, "buyer") === owner &&
      normalizedEventAttribute(protocolEvent, "metalToken") === token &&
      eventAmountEquals(protocolEvent, "metalAmount", transferAmount)
    );
  }

  if (protocolEvent.event_name === "USDSTMinted") {
    return (
      normalizedEventAttribute(protocolEvent, "user") === owner &&
      eventAmountEquals(protocolEvent, "amountUSD", transferAmount)
    );
  }

  if (protocolEvent.event_name === "DirectPSMMinted") {
    return (
      normalizedEventAttribute(protocolEvent, "user") === owner &&
      eventAmountEquals(protocolEvent, "mintAmount", transferAmount)
    );
  }

  if (protocolEvent.event_name === "RewardsClaimed") {
    return (
      normalizedEventAttribute(protocolEvent, "user") === owner &&
      eventAmountEquals(protocolEvent, "amount", transferAmount)
    );
  }

  return false;
};

const sourceForProtocolEvent = (eventName: string): TraceLot["source"] => {
  if (eventName === "Swap") return "swap";
  if (eventName === "MetalMinted") return "metal_mint";
  if (eventName === "USDSTMinted") return "cdp_mint";
  if (eventName === "DirectPSMMinted") return "psm";
  if (eventName === "RewardsClaimed") return "rewards";
  return "transfer";
};

const transferEventAmount = (edge: TraceEdge): bigint | undefined =>
  toBigInt(eventAttribute(edge.to.event || edge.event!, "value"));

const matchesDepositAnchor = (
  event: CirrusEventRow,
  edge: TraceEdge,
): boolean => {
  const owner = normalizeAddress(edge.to.owner);
  const token = normalizeAddress(edge.to.token);
  const lotAmount = toBigInt(edge.to.amount);
  const originalTransferAmount = transferEventAmount(edge);
  const anchorAmount = toBigInt(eventAttribute(event, "stratoTokenAmount"));
  if (lotAmount === undefined || anchorAmount === undefined) return false;

  return (
    normalizedEventAttribute(event, "stratoRecipient") === owner &&
    normalizedEventAttribute(event, "stratoToken") === token &&
    anchorAmount >= lotAmount &&
    (originalTransferAmount === undefined || anchorAmount === originalTransferAmount)
  );
};

const trustAnchorTypeFor = (eventName: string): TrustAnchor["type"] | null => {
  if (eventName === "DepositCompleted") return "MercataBridge.DepositCompleted";
  if (eventName === "NativeDepositCompleted") {
    return "StratoNativeBridge.NativeDepositCompleted";
  }
  return null;
};

const isBeforeCursorEvent = (
  event: CirrusEventRow,
  cursor: TraceCursor,
): boolean => {
  if (!cursor.beforeEvent?.block_number) return true;

  const eventBlock = toBigInt(event.block_number);
  const cursorBlock = toBigInt(cursor.beforeEvent.block_number);
  if (eventBlock === undefined || cursorBlock === undefined) return false;

  return eventBlock < cursorBlock;
};

const toFundingLots = async (
  events: CirrusEventRow[],
  cursor: TraceCursor,
  findAssociatedProtocolEvent: (
    transferEvent: CirrusEventRow,
    cursor: TraceCursor,
  ) => Promise<CirrusEventRow | null>,
): Promise<TraceLot[]> => {
  const lots: TraceLot[] = [];
  let remaining = BigInt(cursor.amount || "0");

  for (const event of events) {
    if (remaining <= 0n) break;

    const eventAmount = toBigInt(eventAttribute(event, "value"));
    if (eventAmount === undefined || eventAmount <= 0n) continue;

    const lotAmount = eventAmount > remaining ? remaining : eventAmount;
    const protocolEvent = await findAssociatedProtocolEvent(event, cursor);
    const fundingEvent = protocolEvent || event;
    lots.push({
      owner: normalizeAddress(cursor.owner),
      token: normalizeAddress(cursor.token),
      amount: lotAmount.toString(),
      transactionHash: fundingEvent.transaction_hash,
      blockNumber: fundingEvent.block_number,
      source: protocolEvent
        ? sourceForProtocolEvent(protocolEvent.event_name)
        : "transfer",
      event: fundingEvent,
    });

    remaining -= lotAmount;
  }

  return lots;
};

const normalizeStandardWithdrawal = (
  row: StandardWithdrawalRow,
): NormalizedWithdrawalAudit => ({
  routeType: "standard",
  withdrawalId: asString(row.key),
  bridgeStatus: asString(row.value.bridgeStatus),
  stratoSender: row.value.stratoSender,
  stratoToken: row.value.stratoToken,
  stratoTokenAmount: row.value.stratoTokenAmount,
  externalChainId: asString(row.value.externalChainId),
  externalRecipient: row.value.externalRecipient,
  externalToken: row.value.externalToken,
  externalTokenAmount: row.value.externalTokenAmount,
  blockTimestamp: row.block_timestamp,
  timestamp: row.value.timestamp || row.value.requestedAt,
  custodyTxHash: row.value.custodyTxHash,
});

const normalizeNativeWithdrawal = (
  row: NativeWithdrawalRow,
): NormalizedWithdrawalAudit => ({
  routeType: "native",
  withdrawalId: asString(row.key),
  bridgeStatus: asString(row.value.bridgeStatus),
  stratoSender: row.value.stratoSender,
  stratoToken: row.value.stratoToken,
  stratoTokenAmount: row.value.stratoTokenAmount,
  externalChainId: asString(row.value.externalChainId),
  externalRecipient: row.value.externalRecipient,
  externalToken: row.value.representationToken || row.value.externalBridge,
  externalTokenAmount: row.value.externalTokenAmount,
  blockTimestamp: row.block_timestamp,
  timestamp: row.value.timestamp || row.value.requestedAt,
  nativeMintProposalHash: row.value.nativeMintProposalHash,
  custodyTxHash: row.value.externalTxHash,
});

export const createWithdrawalRepository = (
  cirrus: CirrusClient,
  config: WasConfig,
): WithdrawalCandidateRepository => {
  const findAssociatedProtocolEvent = async (
    transferEvent: CirrusEventRow,
    cursor: TraceCursor,
  ): Promise<CirrusEventRow | null> => {
    if (!transferEvent.block_number || !transferEvent.transaction_hash) {
      return null;
    }

    const rows = await cirrus.getRows<CirrusEventRow>(EVENT_TABLE, {
      block_number: `eq.${transferEvent.block_number}`,
      transaction_hash: `eq.${transferEvent.transaction_hash}`,
      event_name: `in.(${PROTOCOL_EVENT_NAMES.join(",")})`,
      select: EVENT_SELECT,
      limit: 25,
    });

    return (
      rows.find((event) =>
        matchesProtocolOutput(event, transferEvent, cursor),
      ) || null
    );
  };

  const fetchStandardCandidates = async (
    statusGroup: WithdrawalAuditStatusGroup,
    limit: number,
  ): Promise<NormalizedWithdrawalAudit[]> => {
    const rows = await cirrus.getRows<StandardWithdrawalRow>(
      STANDARD_WITHDRAWALS_TABLE,
      {
        address: `eq.${config.mercataBridge}`,
        "value->>bridgeStatus": statusFilterFor(statusGroup),
        select: WITHDRAWAL_SELECT,
        order: "block_timestamp.desc",
        limit,
      },
    );

    return rows.map(normalizeStandardWithdrawal);
  };

  const fetchNativeCandidates = async (
    statusGroup: WithdrawalAuditStatusGroup,
    limit: number,
  ): Promise<NormalizedWithdrawalAudit[]> => {
    const rows = await cirrus.getRows<NativeWithdrawalRow>(
      NATIVE_WITHDRAWALS_TABLE,
      {
        address: `eq.${config.stratoNativeBridge}`,
        "value->>bridgeStatus": statusFilterFor(statusGroup),
        select: WITHDRAWAL_SELECT,
        order: "block_timestamp.desc",
        limit,
      },
    );

    return rows.map(normalizeNativeWithdrawal);
  };

  return {
    fetchWithdrawalCandidates: async (
      statusGroup: WithdrawalAuditStatusGroup,
      limit: number,
    ) => {
      const [standard, native] = await Promise.all([
        fetchStandardCandidates(statusGroup, limit),
        fetchNativeCandidates(statusGroup, limit),
      ]);

      return [...standard, ...native]
        .sort(
          (a, b) =>
            Date.parse(b.blockTimestamp || b.timestamp || "0") -
            Date.parse(a.blockTimestamp || a.timestamp || "0"),
        )
        .slice(0, limit);
    },

    fetchCanonicalWithdrawalEvent: async (withdrawal) => {
      const eventName =
        withdrawal.routeType === "native"
          ? "NativeWithdrawalRequested"
          : "WithdrawalRequested";
      const address =
        withdrawal.routeType === "native"
          ? config.stratoNativeBridge
          : config.mercataBridge;
      const rows = await cirrus.getRows<CirrusEventRow>(EVENT_TABLE, {
        address: `eq.${address}`,
        event_name: `eq.${eventName}`,
        "attributes->>withdrawalId": `eq.${withdrawal.withdrawalId}`,
        select: EVENT_SELECT,
        order: "block_number.desc",
        limit: 1,
      });

      return rows[0] || null;
    },

    fetchFundingLots: async (cursor: TraceCursor): Promise<TraceLot[]> => {
      const beforeBlock = toBigInt(cursor.beforeEvent?.block_number);
      const rows = await cirrus.getRows<CirrusEventRow>(EVENT_TABLE, {
        address: `eq.${normalizeAddress(cursor.token)}`,
        event_name: "eq.Transfer",
        "attributes->>to": `eq.${normalizeAddress(cursor.owner)}`,
        ...(beforeBlock !== undefined ? { block_number: `lt.${beforeBlock}` } : {}),
        select: EVENT_SELECT,
        order: "block_number.desc",
        limit: 100,
      });

      return toFundingLots(
        rows.filter((event) => isBeforeCursorEvent(event, cursor)),
        cursor,
        findAssociatedProtocolEvent,
      );
    },

    fetchTrustAnchor: async (edge: TraceEdge): Promise<TrustAnchor | null> => {
      if (!edge.event?.block_number || !edge.event.transaction_hash) return null;

      const rows = await cirrus.getRows<CirrusEventRow>(EVENT_TABLE, {
        block_number: `eq.${edge.event.block_number}`,
        transaction_hash: `eq.${edge.event.transaction_hash}`,
        event_name: "in.(DepositCompleted,NativeDepositCompleted)",
        select: EVENT_SELECT,
        limit: 10,
      });

      const anchorEvent = rows.find((event) => matchesDepositAnchor(event, edge));
      if (!anchorEvent) return null;

      const type = trustAnchorTypeFor(anchorEvent.event_name);
      if (!type) return null;

      return {
        type,
        owner: normalizeAddress(edge.to.owner),
        token: normalizeAddress(edge.to.token),
        amount: edge.to.amount,
        event: anchorEvent,
      };
    },
  };
};

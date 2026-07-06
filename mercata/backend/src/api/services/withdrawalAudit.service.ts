import {
  NormalizedWithdrawalAudit,
  WithdrawalAuditListResponse,
  WithdrawalAuditRouteType,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditStep,
  WithdrawalAuditTrace,
} from "@mercata/shared-types";
import { constants } from "../../config/constants";
import { cirrus } from "../../utils/mercataApiHelper";
import { getServiceToken } from "../../utils/authHelper";

type AuditJob = {
  key: string;
  withdrawal: NormalizedWithdrawalAudit;
  accessToken: string;
  quickRun: boolean;
};

type AuditEvent = {
  event_name?: string;
  address?: string;
  attributes?: Record<string, any>;
  block_timestamp?: string;
  block_number?: string | number;
  transaction_hash?: string;
  transaction_sender?: string;
};

type LotProof = {
  clean: bigint;
  tainted: bigint;
  unknown: bigint;
  steps: WithdrawalAuditStep[];
};

type TraceContext = {
  quickRun: boolean;
  protocolEventsSeen: number;
  stoppedEarly: boolean;
};

const AUDIT_SOURCE_LIMIT = 200;
const INCLUDE_TERMINAL_WITHDRAWALS = true;
const auditCache = new Map<string, WithdrawalAuditTrace>();
const auditQueue: AuditJob[] = [];
const queuedKeys = new Set<string>();
let activeJob: AuditJob | null = null;
let warming = false;

const BRIDGE_STATUS_LABELS: Record<string, string> = {
  "0": "NONE",
  "1": "INITIATED",
  "2": "PENDING_REVIEW",
  "3": "COMPLETED",
  "4": "ABORTED",
};

const logWas = (message: string, details?: Record<string, unknown>) => {
  if (details) {
    console.log(`[WAS] ${message}`, details);
    return;
  }
  console.log(`[WAS] ${message}`);
};

const normalizeAddress = (value?: string | null): string =>
  String(value || "").toLowerCase().replace(/^0x/, "");

const nowIso = () => new Date().toISOString();

const getBridgeAddress = (routeType: WithdrawalAuditRouteType): string | undefined =>
  routeType === "native" ? constants.stratoNativeBridge : constants.mercataBridge;

const getBridgeTable = (routeType: WithdrawalAuditRouteType): string =>
  `/${routeType === "native" ? constants.StratoNativeBridge : constants.MercataBridge}-withdrawals`;

const buildAuditCacheKey = (withdrawal: NormalizedWithdrawalAudit, quickRun: boolean): string =>
  [
    withdrawal.routeType,
    withdrawal.withdrawalId,
    withdrawal.bridgeStatus,
    withdrawal.timestamp || withdrawal.blockTimestamp || "",
    `quickRun=${quickRun}`,
  ].join(":");

const makeQueuedTrace = (withdrawal: NormalizedWithdrawalAudit, quickRun = false): WithdrawalAuditTrace => ({
  status: "queued",
  withdrawal,
  quickRun,
  summary: ["Trace queued."],
  steps: [],
  updatedAt: nowIso(),
});

const toStep = (
  index: number,
  params: Omit<WithdrawalAuditStep, "index">
): WithdrawalAuditStep => ({ index, ...params });

const nextStepIndex = (steps: WithdrawalAuditStep[]) => steps.length + 1;

const appendSteps = (target: WithdrawalAuditStep[], additions: WithdrawalAuditStep[]) => {
  for (const step of additions) {
    target.push({ ...step, index: nextStepIndex(target) });
  }
};

const parseBigInt = (value?: string | number | bigint | null): bigint => {
  try {
    if (value == null || value === "") return 0n;
    return BigInt(String(value));
  } catch {
    return 0n;
  }
};

const statusLabel = (status: string): string => BRIDGE_STATUS_LABELS[status] || `UNKNOWN_${status}`;

const statusGroupMatches = (
  withdrawal: NormalizedWithdrawalAudit,
  statusGroup: WithdrawalAuditStatusGroup
): boolean => {
  if (statusGroup === "aborted") return withdrawal.bridgeStatus === "4";
  if (statusGroup === "complete") return withdrawal.bridgeStatus === "3";
  return !["3", "4"].includes(withdrawal.bridgeStatus);
};

const normalizeWithdrawalRow = (
  row: any,
  routeType: WithdrawalAuditRouteType
): NormalizedWithdrawalAudit => {
  const value = row?.value || row?.WithdrawalInfo || {};
  return {
    routeType,
    withdrawalId: String(row?.key || row?.withdrawalId || ""),
    bridgeStatus: String(value.bridgeStatus || "0"),
    stratoSender: normalizeAddress(value.stratoSender),
    stratoToken: normalizeAddress(value.stratoToken),
    stratoTokenAmount: String(value.stratoTokenAmount || "0"),
    externalChainId: String(value.externalChainId || ""),
    externalRecipient: normalizeAddress(value.externalRecipient),
    externalToken: normalizeAddress(value.externalToken || value.representationToken),
    externalTokenAmount: value.externalTokenAmount ? String(value.externalTokenAmount) : undefined,
    blockTimestamp: row?.block_timestamp,
    timestamp: value.timestamp ? String(value.timestamp) : undefined,
    nativeMintProposalHash: value.nativeMintProposalHash || undefined,
    custodyTxHash: value.custodyTxHash || value.externalTxHash || undefined,
  };
};

const sortByBlockTimestampDesc = (a: NormalizedWithdrawalAudit, b: NormalizedWithdrawalAudit) =>
  new Date(b.blockTimestamp || 0).getTime() - new Date(a.blockTimestamp || 0).getTime();

const normalizeEventPosition = (event: AuditEvent): string | undefined => {
  const block = event.block_number;
  const txHash = event.transaction_hash;
  if (block == null && txHash == null) return undefined;
  return [block ?? "?", txHash ?? "?"].join(":");
};

const hasExactPosition = (event?: AuditEvent | null): boolean =>
  event?.block_number != null &&
  event?.transaction_hash != null;

const sameAddress = (a?: string, b?: string): boolean =>
  normalizeAddress(a) === normalizeAddress(b);

const fetchWithdrawalRows = async (
  accessToken: string,
  routeType: WithdrawalAuditRouteType,
  params: Record<string, string>
) => {
  const bridgeAddress = getBridgeAddress(routeType);
  if (!bridgeAddress) return [];
  const response = await cirrus.get(accessToken, getBridgeTable(routeType), {
    params: {
      select: "key,value,block_timestamp",
      address: `eq.${bridgeAddress}`,
      ...params,
    },
  });
  return Array.isArray(response.data) ? response.data : [];
};

const fetchRecentWithdrawals = async (
  accessToken: string,
  limit: number,
  sourceLimit = limit
): Promise<NormalizedWithdrawalAudit[]> => {
  const statusFilter = INCLUDE_TERMINAL_WITHDRAWALS ? "in.(1,2,3,4)" : "in.(1,2)";
  const [standardRows, nativeRows] = await Promise.all([
    fetchWithdrawalRows(accessToken, "standard", {
      "value->>bridgeStatus": statusFilter,
      order: "block_timestamp.desc",
      limit: String(sourceLimit),
    }),
    fetchWithdrawalRows(accessToken, "native", {
      "value->>bridgeStatus": statusFilter,
      order: "block_timestamp.desc",
      limit: String(sourceLimit),
    }),
  ]);

  return [
    ...standardRows.map((row) => normalizeWithdrawalRow(row, "standard")),
    ...nativeRows.map((row) => normalizeWithdrawalRow(row, "native")),
  ]
    .sort(sortByBlockTimestampDesc)
    .slice(0, limit);
};

const fetchWithdrawalById = async (
  accessToken: string,
  routeType: WithdrawalAuditRouteType,
  withdrawalId: string
): Promise<NormalizedWithdrawalAudit | null> => {
  const rows = await fetchWithdrawalRows(accessToken, routeType, {
    key: `eq.${withdrawalId}`,
    limit: "1",
  });
  if (!rows.length) return null;
  return normalizeWithdrawalRow(rows[0], routeType);
};

const fetchBridgeState = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit
): Promise<any | null> => {
  const address = getBridgeAddress(withdrawal.routeType);
  if (!address) return null;
  const response = await cirrus.get(
    accessToken,
    `/${withdrawal.routeType === "native" ? constants.StratoNativeBridge : constants.MercataBridge}`,
    {
      params: {
        address: `eq.${address}`,
        select: "withdrawalsPaused,depositsPaused",
        limit: "1",
      },
    }
  );
  return Array.isArray(response.data) ? response.data[0] : null;
};

const fetchRouteConfig = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit
): Promise<any | null> => {
  const bridgeAddress = getBridgeAddress(withdrawal.routeType);
  if (!bridgeAddress) return null;
  if (withdrawal.routeType === "native") {
    const response = await cirrus.get(accessToken, `/${constants.StratoNativeBridge}-assets`, {
      params: {
        address: `eq.${bridgeAddress}`,
        key: `eq.${withdrawal.stratoToken}`,
        key2: `eq.${withdrawal.externalChainId}`,
        select: "key,key2,value",
        limit: "1",
      },
    });
    return Array.isArray(response.data) ? response.data[0]?.value : null;
  }

  if (!withdrawal.externalToken) return null;
  const response = await cirrus.get(accessToken, `/${constants.MercataBridge}-assets`, {
    params: {
      address: `eq.${bridgeAddress}`,
      key: `eq.${withdrawal.externalToken}`,
      key2: `eq.${withdrawal.externalChainId}`,
      select: "key,key2,value",
      limit: "1",
    },
  });
  return Array.isArray(response.data) ? response.data[0]?.value : null;
};

const fetchRequestEvent = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit
): Promise<AuditEvent | null> => {
  const bridgeAddress = getBridgeAddress(withdrawal.routeType);
  if (!bridgeAddress) return null;
  const eventName =
    withdrawal.routeType === "native" ? "NativeWithdrawalRequested" : "WithdrawalRequested";
  const response = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      address: `eq.${bridgeAddress}`,
      event_name: `eq.${eventName}`,
      "attributes->>withdrawalId": `eq.${withdrawal.withdrawalId}`,
      select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
      limit: "1",
    },
  });
  return Array.isArray(response.data) ? response.data[0] : null;
};

const fetchIncomingEvents = async (
  accessToken: string,
  owner: string,
  token: string
): Promise<AuditEvent[]> => {
  const ownerAddress = normalizeAddress(owner);
  const tokenAddress = normalizeAddress(token);
  const [bridgeDeposits, nativeDeposits, transfers, protocolEvents] = await Promise.all([
    cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        event_name: "eq.DepositCompleted",
        "attributes->>stratoRecipient": `eq.${ownerAddress}`,
        "attributes->>stratoToken": `eq.${tokenAddress}`,
        select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
        limit: String(AUDIT_SOURCE_LIMIT),
      },
    }).catch(() => ({ data: [] })),
    cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        event_name: "eq.NativeDepositCompleted",
        "attributes->>stratoRecipient": `eq.${ownerAddress}`,
        "attributes->>stratoToken": `eq.${tokenAddress}`,
        select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender",
        limit: String(AUDIT_SOURCE_LIMIT),
      },
    }).catch(() => ({ data: [] })),
    cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        event_name: "eq.Transfer",
        address: `eq.${tokenAddress}`,
        "attributes->>to": `eq.${ownerAddress}`,
        select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender,address",
        limit: String(AUDIT_SOURCE_LIMIT),
      },
    }).catch(() => ({ data: [] })),
    cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        or: `(${[
          "event_name.eq.USDSTMinted",
          "event_name.eq.MetalMinted",
          "event_name.eq.DirectPSMMinted",
          "event_name.eq.BurnCompleted",
          "event_name.eq.Swap",
          "event_name.eq.AddLiquidity",
          "event_name.eq.RemoveLiquidity",
          "event_name.eq.RemoveLiquidityOne",
          "event_name.eq.RemoveLiquidityImbalance",
          "event_name.eq.Deposited",
          "event_name.eq.Withdrawn",
          "event_name.eq.Withdraw",
          "event_name.eq.RewardsClaimed",
        ].join(",")})`,
        select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender,address",
        limit: String(AUDIT_SOURCE_LIMIT),
      },
    }).catch(() => ({ data: [] })),
  ]);

  const candidates = [
    ...(Array.isArray(bridgeDeposits.data) ? bridgeDeposits.data : []),
    ...(Array.isArray(nativeDeposits.data) ? nativeDeposits.data : []),
    ...(Array.isArray(transfers.data) ? transfers.data : []),
    ...(Array.isArray(protocolEvents.data) ? protocolEvents.data : []).filter((event: AuditEvent) =>
      protocolEventCanCredit(event, ownerAddress, tokenAddress)
    ),
  ];

  return candidates.sort((a, b) =>
    new Date(b.block_timestamp || 0).getTime() - new Date(a.block_timestamp || 0).getTime()
  );
};

const fetchTransactionEvents = async (
  accessToken: string,
  transactionHash?: string
): Promise<AuditEvent[]> => {
  if (!transactionHash) return [];
  const response = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      transaction_hash: `eq.${transactionHash}`,
      select: "event_name,attributes,block_timestamp,block_number,transaction_hash,transaction_sender,address",
      limit: "100",
    },
  }).catch(() => ({ data: [] }));
  return Array.isArray(response.data) ? response.data : [];
};

const fetchOutgoingAmount = async (
  accessToken: string,
  owner: string,
  token: string
): Promise<bigint> => {
  const response = await cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      event_name: "eq.Transfer",
      address: `eq.${normalizeAddress(token)}`,
      "attributes->>from": `eq.${normalizeAddress(owner)}`,
      select: "attributes",
      limit: String(AUDIT_SOURCE_LIMIT),
    },
  }).catch(() => ({ data: [] }));

  return (Array.isArray(response.data) ? response.data : []).reduce(
    (sum: bigint, event: AuditEvent) => sum + getEventAmount(event),
    0n
  );
};

const protocolEventCanCredit = (
  event: AuditEvent,
  owner: string,
  token: string
): boolean => {
  const output = getProtocolOutput(event, token);
  if (!output) return false;
  return (!output.owner || sameAddress(output.owner, owner)) &&
    (!output.token || sameAddress(output.token, token));
};

const getProtocolOutput = (
  event: AuditEvent,
  transferToken?: string
): { owner?: string; token?: string; amount: bigint } | null => {
  const a = event.attributes || {};
  switch (event.event_name) {
    case "USDSTMinted":
      return {
        owner: normalizeAddress(a.user || a.sender),
        token: constants.USDST,
        amount: parseBigInt(a.amountUSD),
      };
    case "MetalMinted":
      return {
        owner: normalizeAddress(a.buyer),
        token: normalizeAddress(a.metalToken),
        amount: parseBigInt(a.metalAmount),
      };
    case "DirectPSMMinted":
      return {
        owner: normalizeAddress(a.user),
        token: transferToken ? normalizeAddress(transferToken) : undefined,
        amount: parseBigInt(a.mintAmount),
      };
    case "BurnCompleted":
      return {
        owner: normalizeAddress(a.recipient || a.requester),
        token: normalizeAddress(a.redeemToken),
        amount: parseBigInt(a.payoutAmount),
      };
    case "Swap":
      return {
        owner: normalizeAddress(a.sender),
        token: normalizeAddress(a.tokenOut),
        amount: parseBigInt(a.amountOut),
      };
    case "AddLiquidity":
      return {
        owner: normalizeAddress(a.provider),
        token: transferToken ? normalizeAddress(transferToken) : undefined,
        amount: parseBigInt(a.tokenSupply),
      };
    case "RemoveLiquidity":
    case "RemoveLiquidityOne":
    case "RemoveLiquidityImbalance":
      return {
        owner: normalizeAddress(a.provider),
        token: transferToken ? normalizeAddress(transferToken) : undefined,
        amount: parseBigInt(a.coinamount || a.tokenamount || a.tokenSupply),
      };
    case "Deposited":
      return {
        owner: normalizeAddress(a.user || a.owner || a.receiver),
        token: transferToken ? normalizeAddress(transferToken) : undefined,
        amount: parseBigInt(a.shares || a.sharesMinted || a.mTokenAmount),
      };
    case "Withdrawn":
    case "Withdraw":
      return {
        owner: normalizeAddress(a.user || a.receiver || a.owner),
        token: transferToken ? normalizeAddress(transferToken) : normalizeAddress(a.asset),
        amount: parseBigInt(a.amount || a.assets || a.amountUSD),
      };
    case "RewardsClaimed":
      return {
        owner: normalizeAddress(a.user),
        token: transferToken ? normalizeAddress(transferToken) : undefined,
        amount: parseBigInt(a.amount),
      };
    default:
      return null;
  }
};

const findProtocolEventForTransfer = async (
  accessToken: string,
  transfer: AuditEvent,
  owner: string,
  token: string,
  amount: bigint
): Promise<AuditEvent | null> => {
  const txEvents = await fetchTransactionEvents(accessToken, transfer.transaction_hash);
  const protocolEvents = txEvents.filter((event) => event.event_name !== "Transfer");
  const transferSender = normalizeAddress(transfer.attributes?.from || transfer.attributes?.sender);
  const transferRecipient = normalizeAddress(transfer.attributes?.to || transfer.attributes?.receiver);

  for (const event of protocolEvents) {
    if (event.event_name === "Swap") {
      const a = event.attributes || {};
      const swapTokenOut = normalizeAddress(a.tokenOut);
      const swapAmountOut = parseBigInt(a.amountOut);
      const emittedByPool = normalizeAddress(event.address);
      const stablePoolSwapMatches =
        sameAddress(transferRecipient, owner) &&
        sameAddress(transferSender, emittedByPool) &&
        sameAddress(swapTokenOut, token) &&
        swapAmountOut === amount;
      if (stablePoolSwapMatches) {
        return event;
      }
    }

    const output = getProtocolOutput(event, token);
    if (!output) continue;
    const ownerMatches = !output.owner || sameAddress(output.owner, owner);
    const tokenMatches = !output.token || sameAddress(output.token, token);
    const amountMatches = output.amount === 0n || output.amount === amount;
    if (ownerMatches && tokenMatches && amountMatches) {
      return event;
    }
  }
  return null;
};

const countProtocolEventsForWithdrawal = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit,
  maxEvents = 5
): Promise<number> => {
  let seen = 0;
  const visited = new Set<string>();

  const walk = async (
    owner: string,
    token: string,
    depth: number
  ): Promise<void> => {
    if (seen >= maxEvents || depth > 8) return;
    const visitKey = `${owner}:${token}:${depth}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const incomingEvents = await fetchIncomingEvents(accessToken, owner, token);
    for (const event of incomingEvents) {
      if (seen >= maxEvents) return;

      if (event.event_name === "Transfer") {
        const amount = getEventAmount(event);
        const protocolEvent = await findProtocolEventForTransfer(accessToken, event, owner, token, amount);
        if (protocolEvent) {
          seen += 1;
          const input = getProtocolInput(protocolEvent);
          if (input?.token && input.amount > 0n) {
            await walk(input.owner || owner, input.token, depth + 1);
          }
          continue;
        }

        const sender = normalizeAddress(event.attributes?.from || event.attributes?.sender);
        if (sender && !/^0+$/.test(sender)) {
          await walk(sender, token, depth + 1);
        }
        continue;
      }

      if (event.event_name !== "DepositCompleted" && event.event_name !== "NativeDepositCompleted") {
        seen += 1;
        const input = getProtocolInput(event);
        if (input?.token && input.amount > 0n) {
          await walk(input.owner || owner, input.token, depth + 1);
        }
      }
    }
  };

  await walk(withdrawal.stratoSender, withdrawal.stratoToken, 0);
  return seen;
};

const fetchRecentWithdrawalsWithProtocolDepth = async (
  accessToken: string,
  limit: number,
  statusGroup?: WithdrawalAuditStatusGroup
): Promise<NormalizedWithdrawalAudit[]> => {
  const result: NormalizedWithdrawalAudit[] = [];
  const sourceLimit = Math.max(limit * 5, 25);
  const candidates = await fetchRecentWithdrawals(accessToken, sourceLimit, sourceLimit);

  for (const withdrawal of candidates) {
    if (result.length >= limit) break;
    if (statusGroup && !statusGroupMatches(withdrawal, statusGroup)) continue;
    const protocolEvents = await countProtocolEventsForWithdrawal(accessToken, withdrawal, 5);
    logWas(`Protocol depth check for ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
      protocolEvents,
      required: 5,
    });
    if (protocolEvents >= 5) {
      result.push(withdrawal);
    }
  }

  return result;
};

const getEventAmount = (event: AuditEvent): bigint => {
  const a = event.attributes || {};
  return parseBigInt(
    a.amount ||
      a.value ||
      a.stratoTokenAmount ||
      a.amountUSD ||
      a.metalAmount ||
      a.mintAmount ||
      a.payoutAmount ||
      a.amountOut ||
      a.assets ||
      a.shares ||
      0
  );
};

const proveLot = async (
  accessToken: string,
  event: AuditEvent,
  owner: string,
  token: string,
  amount: bigint,
  depth: number,
  context: TraceContext
): Promise<LotProof> => {
  const steps: WithdrawalAuditStep[] = [];
  const eventType = event.event_name || "Unknown";
  const position = normalizeEventPosition(event);
  const a = event.attributes || {};

  if (depth > 8) {
    steps.push(toStep(nextStepIndex(steps), {
      eventType,
      position,
      actor: owner,
      token,
      amount: amount.toString(),
      result: "unknown",
      explanation: "Trace depth limit reached before a bridge deposit anchor.",
      evidence: {},
    }));
    return { clean: 0n, tainted: 0n, unknown: amount, steps };
  }

  if (!hasExactPosition(event)) {
    steps.push(toStep(nextStepIndex(steps), {
      eventType,
      position,
      actor: owner,
      token,
      amount: amount.toString(),
      result: "unknown",
      explanation: "Event is missing block or transaction hash identity fields.",
      evidence: { blockTimestamp: event.block_timestamp || "" },
    }));
    return { clean: 0n, tainted: 0n, unknown: amount, steps };
  }

  if (eventType === "DepositCompleted" || eventType === "NativeDepositCompleted") {
    steps.push(toStep(nextStepIndex(steps), {
      eventType,
      position,
      actor: owner,
      token,
      amount: amount.toString(),
      result: "clean",
      explanation: "Verified bridge completion is treated as a provenance anchor.",
      evidence: {
        externalTxHash: String(a.externalTxHash || ""),
        externalChainId: String(a.externalChainId || ""),
        externalRedemptionId: String(a.externalRedemptionId || ""),
      },
    }));
    return { clean: amount, tainted: 0n, unknown: 0n, steps };
  }

  if (eventType === "Transfer") {
    const sender = normalizeAddress(a.from || a.sender);
    const protocolEvent = await findProtocolEventForTransfer(accessToken, event, owner, token, amount);
    if (protocolEvent) {
      context.protocolEventsSeen += 1;
      logWas(`Mapped transfer lot to protocol event ${protocolEvent.event_name}`, {
        transactionHash: event.transaction_hash || "",
        owner,
        token,
        amount: amount.toString(),
        protocolEventsSeen: context.protocolEventsSeen,
        quickRun: context.quickRun,
      });
      if (context.quickRun && context.protocolEventsSeen >= 5) {
        context.stoppedEarly = true;
        return {
          clean: 0n,
          tainted: 0n,
          unknown: amount,
          steps: [toStep(1, {
            eventType: protocolEvent.event_name || "ProtocolEvent",
            position: normalizeEventPosition(protocolEvent),
            actor: owner,
            token,
            amount: amount.toString(),
            result: "unknown",
            explanation: "Quick run stopped after finding five protocol events.",
            evidence: {
              transactionHash: event.transaction_hash || "",
              protocolEventsSeen: String(context.protocolEventsSeen),
            },
          })],
        };
      }
      const proof = await proveProtocolEdge(accessToken, protocolEvent, owner, token, amount, depth, context);
      const [firstStep, ...rest] = proof.steps;
      const mappedStep = firstStep
        ? {
            ...firstStep,
            explanation: `${firstStep.explanation} Incoming transfer was matched to this protocol event in the same transaction.`,
            evidence: {
              ...firstStep.evidence,
              transactionHash: event.transaction_hash || "",
              transferSender: sender,
            },
          }
        : toStep(1, {
            eventType: protocolEvent.event_name || "ProtocolEvent",
            position: normalizeEventPosition(protocolEvent),
            actor: owner,
            token,
            amount: amount.toString(),
            result: proof.tainted > 0n ? "tainted" : proof.unknown > 0n ? "unknown" : "clean",
            explanation: "Incoming transfer was matched to this protocol event in the same transaction.",
            evidence: {
              transactionHash: event.transaction_hash || "",
              transferSender: sender,
            },
          });
      return { ...proof, steps: [mappedStep, ...rest] };
    }

    if (!sender || /^0+$/.test(sender)) {
      steps.push(toStep(nextStepIndex(steps), {
        eventType,
        position,
        actor: owner,
        token,
        amount: amount.toString(),
        result: "unknown",
        explanation: "Transfer appears to be a mint without a recognized protocol source.",
        evidence: { sender },
      }));
      return { clean: 0n, tainted: 0n, unknown: amount, steps };
    }

    const proof = await proveCleanBalance(accessToken, sender, token, amount, depth + 1, context);
    return {
      ...proof,
      steps: [
        toStep(1, {
          eventType,
          position,
          actor: owner,
          token,
          amount: amount.toString(),
          result: proof.tainted > 0n ? "tainted" : proof.unknown > 0n ? "unknown" : "clean",
          explanation: `Transfer inherits provenance from sender ${sender}.`,
          evidence: { sender },
        }),
        ...proof.steps.map((step, index) => ({ ...step, index: index + 2 })),
      ],
    };
  }

  return proveProtocolEdge(accessToken, event, owner, token, amount, depth, context);
};

const proveProtocolEdge = async (
  accessToken: string,
  event: AuditEvent,
  owner: string,
  token: string,
  amount: bigint,
  depth: number,
  context: TraceContext
): Promise<LotProof> => {
  const a = event.attributes || {};
  const eventType = event.event_name || "Unknown";
  const position = normalizeEventPosition(event);
  const input = getProtocolInput(event);

  if (!input || !input.token || input.amount <= 0n) {
    return {
      clean: 0n,
      tainted: 0n,
      unknown: amount,
      steps: [toStep(1, {
        eventType,
        position,
        actor: owner,
        token,
        amount: amount.toString(),
        result: "unknown",
        explanation: "Protocol edge is recognized but required input evidence is incomplete.",
        evidence: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])),
      })],
    };
  }

  const proof = await proveCleanBalance(accessToken, input.owner || owner, input.token, input.amount, depth + 1, context);
  const result = proof.tainted > 0n ? "tainted" : proof.unknown > 0n ? "unknown" : "clean";
  return {
    clean: result === "clean" ? amount : 0n,
    tainted: result === "tainted" ? amount : 0n,
    unknown: result === "unknown" ? amount : 0n,
    steps: [
      toStep(1, {
        eventType,
        position,
        actor: owner,
        token,
        amount: amount.toString(),
        result,
        explanation: `Protocol output inherits provenance from ${input.amount.toString()} of ${input.token}.`,
        evidence: { inputOwner: input.owner || owner, inputToken: input.token, inputAmount: input.amount.toString() },
      }),
      ...proof.steps.map((step, index) => ({ ...step, index: index + 2 })),
    ],
  };
};

const getProtocolInput = (event: AuditEvent): { owner?: string; token: string; amount: bigint } | null => {
  const a = event.attributes || {};
  switch (event.event_name) {
    case "USDSTMinted":
      return a.collateralAmount
        ? { owner: normalizeAddress(a.user || a.sender), token: normalizeAddress(a.asset), amount: parseBigInt(a.collateralAmount) }
        : null;
    case "MetalMinted":
      return { owner: normalizeAddress(a.buyer), token: normalizeAddress(a.payToken), amount: parseBigInt(a.payAmount) };
    case "DirectPSMMinted":
      return { owner: normalizeAddress(a.user), token: normalizeAddress(a.againstToken), amount: parseBigInt(a.depositAmount) };
    case "BurnCompleted":
      return { owner: normalizeAddress(a.recipient || a.requester), token: normalizeAddress(a.mintableToken), amount: parseBigInt(a.burnAmount) };
    case "Swap":
      return { owner: normalizeAddress(a.sender), token: normalizeAddress(a.tokenIn), amount: parseBigInt(a.amountIn) };
    case "Deposited":
      return { owner: normalizeAddress(a.user || a.caller), token: normalizeAddress(a.asset || a.assetIn), amount: parseBigInt(a.amount || a.amountIn || a.assets) };
    case "Withdrawn":
    case "Withdraw":
      return { owner: normalizeAddress(a.user || a.owner), token: normalizeAddress(a.shareToken || ""), amount: parseBigInt(a.shares || a.sharesBurned) };
    case "RewardsClaimed":
      return null;
    default:
      return null;
  }
};

const proveCleanBalance = async (
  accessToken: string,
  owner: string,
  token: string,
  amount: bigint,
  depth = 0,
  context: TraceContext
): Promise<LotProof> => {
  const steps: WithdrawalAuditStep[] = [];
  const incomingEvents = await fetchIncomingEvents(accessToken, owner, token);
  const spent = await fetchOutgoingAmount(accessToken, owner, token);
  let remainingSpend = spent;
  let needed = amount;
  let clean = 0n;
  let tainted = 0n;
  let unknown = 0n;

  for (const event of incomingEvents) {
    if (needed <= 0n) break;
    if (context.stoppedEarly) break;
    const eventAmount = getEventAmount(event);
    if (eventAmount <= 0n) continue;
    const consumedByLaterSpend = remainingSpend > eventAmount ? eventAmount : remainingSpend;
    remainingSpend -= consumedByLaterSpend;
    const available = eventAmount - consumedByLaterSpend;
    if (available <= 0n) continue;

    const proofAmount = available > needed ? needed : available;
    const proof = await proveLot(accessToken, event, owner, token, proofAmount, depth, context);
    clean += proof.clean;
    tainted += proof.tainted;
    unknown += proof.unknown;
    needed -= proof.clean;
    appendSteps(steps, proof.steps);
  }

  if (needed > 0n && tainted === 0n) {
    unknown += needed;
    steps.push(toStep(nextStepIndex(steps), {
      eventType: "CoverageGap",
      actor: owner,
      token,
      amount: needed.toString(),
      result: "unknown",
      explanation: "Could not find enough incoming provenance lots to cover the requested amount.",
      evidence: { requestedAmount: amount.toString() },
    }));
  }

  return { clean, tainted, unknown, steps };
};

const traceWithdrawal = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit,
  quickRun: boolean
): Promise<WithdrawalAuditTrace> => {
  const context: TraceContext = {
    quickRun,
    protocolEventsSeen: 0,
    stoppedEarly: false,
  };

  logWas(`Trace started for ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
    routeType: withdrawal.routeType,
    withdrawalId: withdrawal.withdrawalId,
    stratoSender: withdrawal.stratoSender,
    stratoToken: withdrawal.stratoToken,
    stratoTokenAmount: withdrawal.stratoTokenAmount,
    bridgeStatus: withdrawal.bridgeStatus,
    quickRun,
  });

  const steps: WithdrawalAuditStep[] = [];
  const amount = parseBigInt(withdrawal.stratoTokenAmount);
  const bridgeAddress = getBridgeAddress(withdrawal.routeType);

  steps.push(toStep(nextStepIndex(steps), {
    eventType: "WithdrawalLoaded",
    actor: withdrawal.stratoSender,
    token: withdrawal.stratoToken,
    amount: withdrawal.stratoTokenAmount,
    result: "info",
    explanation: "Loaded withdrawal record for audit.",
    evidence: {
      routeType: withdrawal.routeType,
      withdrawalId: withdrawal.withdrawalId,
      bridgeStatus: withdrawal.bridgeStatus,
    },
  }));

  if (!["1", "2"].includes(withdrawal.bridgeStatus) && !INCLUDE_TERMINAL_WITHDRAWALS) {
    logWas(`Skipping provenance walk for ${withdrawal.routeType}:${withdrawal.withdrawalId}; withdrawal is not reviewable`, {
      bridgeStatus: withdrawal.bridgeStatus,
      statusLabel: statusLabel(withdrawal.bridgeStatus),
      reason: "Only INITIATED or PENDING_REVIEW withdrawals are audited by the POC.",
    });
    steps.push(toStep(nextStepIndex(steps), {
      eventType: "BridgeState",
      result: "unknown",
      explanation: "Only initiated or pending review withdrawals are audited by this POC.",
      evidence: { bridgeStatus: withdrawal.bridgeStatus },
    }));
    return completeTrace(withdrawal, "MANUAL_REVIEW", "medium", { clean: 0n, tainted: 0n, unknown: amount }, steps, context);
  }

  const [bridgeState, routeConfig, requestEvent] = await Promise.all([
    fetchBridgeState(accessToken, withdrawal),
    fetchRouteConfig(accessToken, withdrawal),
    fetchRequestEvent(accessToken, withdrawal),
  ]);

  steps.push(toStep(nextStepIndex(steps), {
    eventType: "RouteConfig",
    result: bridgeState?.withdrawalsPaused || !routeConfig ? "unknown" : "info",
    explanation: routeConfig
      ? "Bridge route configuration was found."
      : "Bridge route configuration could not be found.",
    evidence: {
      bridgeAddress: bridgeAddress || "",
      withdrawalsPaused: String(bridgeState?.withdrawalsPaused ?? ""),
      routeEnabled: String(routeConfig?.enabled ?? ""),
      maxPerWithdrawal: String(routeConfig?.maxPerWithdrawal ?? ""),
    },
  }));

  if (!requestEvent) {
    steps.push(toStep(nextStepIndex(steps), {
      eventType: "WithdrawalRequestEvent",
      result: "unknown",
      explanation: "Could not locate the canonical withdrawal request event.",
      evidence: {},
    }));
    return completeTrace(withdrawal, "MANUAL_REVIEW", "medium", { clean: 0n, tainted: 0n, unknown: amount }, steps, context);
  }

  steps.push(toStep(nextStepIndex(steps), {
    eventType: requestEvent.event_name || "WithdrawalRequested",
    position: normalizeEventPosition(requestEvent),
    actor: withdrawal.stratoSender,
    token: withdrawal.stratoToken,
    amount: withdrawal.stratoTokenAmount,
    result: hasExactPosition(requestEvent) ? "info" : "unknown",
    explanation: hasExactPosition(requestEvent)
      ? "Found request event block and transaction hash."
      : "Request event is missing block or transaction hash identity fields.",
    evidence: { transactionHash: requestEvent.transaction_hash || "" },
  }));

  if (!hasExactPosition(requestEvent)) {
    return completeTrace(withdrawal, "MANUAL_REVIEW", "medium", { clean: 0n, tainted: 0n, unknown: amount }, steps, context);
  }

  const coverage = await proveCleanBalance(
    accessToken,
    withdrawal.stratoSender,
    withdrawal.stratoToken,
    amount,
    0,
    context
  );
  appendSteps(steps, coverage.steps);

  const proposalStep = validateProposalReference(withdrawal, steps.length + 1);
  steps.push(proposalStep);

  const proposalMismatch = proposalStep.result === "tainted";
  const decision = proposalMismatch || coverage.tainted > 0n
    ? "REJECT"
    : coverage.clean >= amount && coverage.unknown === 0n
      ? "APPROVE"
      : "MANUAL_REVIEW";
  const riskLevel = decision === "APPROVE" ? "low" : decision === "REJECT" ? "high" : "medium";
  logWas(`Trace completed for ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
    decision,
    clean: coverage.clean.toString(),
    tainted: coverage.tainted.toString(),
    unknown: coverage.unknown.toString(),
    quickRun,
    protocolEventsSeen: context.protocolEventsSeen,
    stoppedEarly: context.stoppedEarly,
  });
  return completeTrace(withdrawal, decision, riskLevel, coverage, steps, context);
};

const validateProposalReference = (
  withdrawal: NormalizedWithdrawalAudit,
  index: number
): WithdrawalAuditStep => {
  const reference = withdrawal.routeType === "native"
    ? withdrawal.nativeMintProposalHash
    : withdrawal.custodyTxHash;
  return toStep(index, {
    eventType: "SafeProposal",
    result: reference ? "info" : "unknown",
    explanation: reference
      ? "Safe proposal reference is present. Full calldata decoding is outside this backend POC."
      : "Safe proposal reference is not yet present for this withdrawal.",
    evidence: { proposalReference: reference || "" },
  });
};

const completeTrace = (
  withdrawal: NormalizedWithdrawalAudit,
  decision: "APPROVE" | "REJECT" | "MANUAL_REVIEW",
  riskLevel: "low" | "medium" | "high",
  coverage: { clean: bigint; tainted: bigint; unknown: bigint },
  steps: WithdrawalAuditStep[],
  context: TraceContext
): WithdrawalAuditTrace => {
  const result = {
    status: "complete" as const,
    decision,
    riskLevel,
    withdrawal,
    quickRun: context.quickRun,
    stoppedEarly: context.stoppedEarly,
    coverage: {
      clean: coverage.clean.toString(),
      tainted: coverage.tainted.toString(),
      unknown: coverage.unknown.toString(),
    },
    summary: [
      ...(context.stoppedEarly
        ? [`Quick run stopped after ${context.protocolEventsSeen} protocol events.`]
        : []),
      decision === "APPROVE"
        ? "Full requested amount was covered by clean provenance."
        : decision === "REJECT"
          ? "Trace found tainted funds or a proposal mismatch."
          : "Trace could not prove full clean provenance from available event data.",
    ],
    steps,
    updatedAt: nowIso(),
  };

  logWas(`Trace finalized for ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
    decision,
    riskLevel,
    bridgeStatus: withdrawal.bridgeStatus,
    statusLabel: statusLabel(withdrawal.bridgeStatus),
    clean: result.coverage.clean,
    tainted: result.coverage.tainted,
    unknown: result.coverage.unknown,
    stepCount: steps.length,
    quickRun: context.quickRun,
    protocolEventsSeen: context.protocolEventsSeen,
    stoppedEarly: context.stoppedEarly,
  });

  return result;
};

const processQueue = () => {
  if (activeJob) return;
  const job = auditQueue.shift();
  if (!job) return;
  activeJob = job;
  queuedKeys.delete(job.key);
  logWas(`Processing queued trace ${job.withdrawal.routeType}:${job.withdrawal.withdrawalId}`, {
    queueRemaining: auditQueue.length,
    key: job.key,
    quickRun: job.quickRun,
  });
  auditCache.set(job.key, {
    ...(auditCache.get(job.key) || makeQueuedTrace(job.withdrawal, job.quickRun)),
    status: "running",
    summary: ["Trace running."],
    updatedAt: nowIso(),
  });

  void traceWithdrawal(job.accessToken, job.withdrawal, job.quickRun)
    .then((trace) => auditCache.set(job.key, trace))
    .catch((error) => {
      console.error(`[WAS] Trace failed for ${job.withdrawal.routeType}:${job.withdrawal.withdrawalId}`, error);
      auditCache.set(job.key, {
        status: "failed",
        withdrawal: job.withdrawal,
        summary: ["Trace failed."],
        steps: [],
        updatedAt: nowIso(),
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      activeJob = null;
      processQueue();
    });
};

const ensureAuditQueued = (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit,
  quickRun: boolean
): WithdrawalAuditTrace => {
  const key = buildAuditCacheKey(withdrawal, quickRun);
  const cached = auditCache.get(key);
  if (cached && ["queued", "running", "complete"].includes(cached.status)) {
    return cached;
  }

  const queued = makeQueuedTrace(withdrawal, quickRun);
  auditCache.set(key, queued);
  if (!queuedKeys.has(key)) {
    logWas(`Queued trace for ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
      key,
      queueSizeBeforePush: auditQueue.length,
      quickRun,
    });
    auditQueue.push({ key, withdrawal, accessToken, quickRun });
    queuedKeys.add(key);
    processQueue();
  }
  return queued;
};

const runAuditNow = async (
  accessToken: string,
  withdrawal: NormalizedWithdrawalAudit,
  quickRun: boolean
): Promise<WithdrawalAuditTrace> => {
  const key = buildAuditCacheKey(withdrawal, quickRun);
  const cached = auditCache.get(key);
  if (cached?.status === "complete") {
    return cached;
  }

  logWas(`Running trace immediately for review list ${withdrawal.routeType}:${withdrawal.withdrawalId}`, {
    key,
    quickRun,
  });
  const runningTrace: WithdrawalAuditTrace = {
    ...(cached || makeQueuedTrace(withdrawal, quickRun)),
    status: "running",
    summary: ["Trace running."],
    updatedAt: nowIso(),
  };
  auditCache.set(key, runningTrace);

  try {
    const trace = await traceWithdrawal(accessToken, withdrawal, quickRun);
    auditCache.set(key, trace);
    return trace;
  } catch (error) {
    const failed: WithdrawalAuditTrace = {
      status: "failed",
      withdrawal,
      quickRun,
      summary: ["Trace failed."],
      steps: [],
      updatedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error),
    };
    auditCache.set(key, failed);
    return failed;
  }
};

export const warmWithdrawalAuditCache = async (
  limit = 10,
  quickRun = true
): Promise<void> => {
  if (warming) {
    logWas("Cache warming already in progress.", { quickRun });
    return;
  }

  warming = true;
  try {
    const accessToken = await getServiceToken();
    const normalizedLimit = Math.min(Math.max(limit, 1), 10);
    const statusGroups: WithdrawalAuditStatusGroup[] = ["other", "complete", "aborted"];
    const withdrawalsByKey = new Map<string, NormalizedWithdrawalAudit>();

    for (const statusGroup of statusGroups) {
      const groupWithdrawals = quickRun
        ? await fetchRecentWithdrawalsWithProtocolDepth(accessToken, normalizedLimit, statusGroup)
        : (await fetchRecentWithdrawals(accessToken, Math.max(normalizedLimit * 5, 25), Math.max(normalizedLimit * 5, 25)))
            .filter((withdrawal) => statusGroupMatches(withdrawal, statusGroup))
            .slice(0, normalizedLimit);
      logWas(`Selected ${groupWithdrawals.length} withdrawal(s) for ${statusGroup} cache warming.`, {
        quickRun,
        statusGroup,
        limit: normalizedLimit,
      });
      for (const withdrawal of groupWithdrawals) {
        withdrawalsByKey.set(`${withdrawal.routeType}:${withdrawal.withdrawalId}`, withdrawal);
      }
    }

    const withdrawals = [...withdrawalsByKey.values()].sort(sortByBlockTimestampDesc);

    logWas(`Warming cache for ${withdrawals.length} withdrawal audit(s).`, {
      quickRun,
      limit: normalizedLimit,
    });

    for (const withdrawal of withdrawals) {
      await runAuditNow(accessToken, withdrawal, quickRun);
    }

    logWas("Cache warming complete.", {
      quickRun,
      cachedAudits: [...auditCache.values()].filter((audit) => audit.quickRun === quickRun && audit.status === "complete").length,
    });
  } catch (error) {
    console.error("[WAS] Cache warming failed", error);
  } finally {
    warming = false;
  }
};

export const getRecentWithdrawalAudits = async (
  limit = 10,
  quickRun = false,
  statusGroup: WithdrawalAuditStatusGroup = "other"
): Promise<WithdrawalAuditListResponse> => {
  const normalizedLimit = Math.min(Math.max(limit, 1), 10);
  const data = [...auditCache.values()]
    .filter((audit) => audit.quickRun === quickRun && audit.status === "complete")
    .filter((audit) => statusGroupMatches(audit.withdrawal, statusGroup))
    .sort(sortAuditTraceByBlockTimestampDesc)
    .slice(0, normalizedLimit)
    .map((audit) => ({ withdrawal: audit.withdrawal, audit }));

  logWas(`Read ${data.length} ready audit(s) from cache.`, { quickRun, limit: normalizedLimit, statusGroup });

  return {
    data,
  };
};

export const getWithdrawalAudit = async (
  routeType: WithdrawalAuditRouteType,
  withdrawalId: string,
  quickRun = false
): Promise<WithdrawalAuditTrace | null> => {
  const cached = [...auditCache.values()]
    .filter((audit) =>
      audit.quickRun === quickRun &&
      audit.withdrawal.routeType === routeType &&
      audit.withdrawal.withdrawalId === withdrawalId
    )
    .sort(sortAuditTraceByBlockTimestampDesc)[0];
  if (!cached) {
    logWas(`Audit cache miss for ${routeType}:${withdrawalId}`, { quickRun });
    return null;
  }
  return cached;
};

const sortAuditTraceByBlockTimestampDesc = (a: WithdrawalAuditTrace, b: WithdrawalAuditTrace) =>
  sortByBlockTimestampDesc(a.withdrawal, b.withdrawal);


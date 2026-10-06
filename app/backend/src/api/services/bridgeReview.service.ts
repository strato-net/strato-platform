import { ExternalBridgeStatus } from "@strato/shared-types";
import { BridgePolicyOverview, BridgePolicyRecords, BridgeReviewRecords, buildBridgeReviewQueue, BridgeReviewItem, BridgeReviewRow, BridgeReviewVote } from "@strato/shared-types";
import axios from "axios";
import { nodeUrl, adminRegistry } from "../../config/config";
import { constants, BRIDGE_REVIEW_PAGE_SIZE, BRIDGE_REVIEW_ID_BATCH_SIZE } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import { StratoError } from "../../errors";
import { buildBridgePolicyRows, parseBridgePolicyJson, buildBridgeDigestCall, parseBridgeDigest, parseBridgeReviewIssue, bridgeReviewFunction } from "../helpers/bridge.helper";

const readReviewRows = async <T = BridgeReviewRow>(accessToken: string, contract: string, address: string, table: string, filters: Record<string, string>, lossless = false): Promise<T[]> => {
  if (!address) return [];
  const rows: T[] = [];
  for (;;) {
    const { data } = await cirrus.get(accessToken, `/${contract}${table ? `-${table}` : ""}`, { ...(lossless ? { transformResponse: [parseBridgePolicyJson] } : {}), params: {
      address: `eq.${address}`, select: "key,value", order: "key.asc", ...filters,
      limit: BRIDGE_REVIEW_PAGE_SIZE, offset: rows.length,
    } });
    if (!Array.isArray(data)) throw new Error("Invalid bridge review response from Cirrus");
    if (!data.length) return rows;
    rows.push(...data);
  }
};

export const getAdminBridgeReviews = async (accessToken: string, userAddress?: string): Promise<BridgeReviewItem[]> => {
  const { ExternalAssetBridge, externalAssetBridge, StratoNativeBridge, stratoNativeBridge } = constants;
  const [deposits, withdrawals, nativeDeposits, nativeWithdrawals] = await Promise.all([
    readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "deposits", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc", "value->>status": `in.(0,${"0".repeat(40)},2,7,8)` }),
    readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "withdrawals", { "value->>status": "in.(2,3)" }),
    readReviewRows(accessToken, StratoNativeBridge, stratoNativeBridge, "deposits", { "value->>bridgeStatus": "in.(2,4,7)" }),
    readReviewRows(accessToken, StratoNativeBridge, stratoNativeBridge, "withdrawals", { "value->>bridgeStatus": `in.(2,${ExternalBridgeStatus.CANCELLATION_PENDING})` }),
  ]);
  const ids = withdrawals.filter(row => String(row.value.status) === "2").map(row => row.key);
  const reviews: BridgeReviewRow[] = [];
  for (let offset = 0; offset < ids.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    reviews.push(...await readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "withdrawalManualReviews", {
      key: `in.(${ids.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE).join(",")})`,
    }));
  }
  const nativeRefundIds = nativeDeposits.filter(row => Number(row.value.bridgeStatus) === 7).map(row => row.key);
  for (let offset = 0; offset < nativeRefundIds.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    const [proposals, evidence] = await Promise.all(["depositRefundProposals", "depositRefundEvidence"].map(table =>
      readReviewRows(accessToken, StratoNativeBridge, stratoNativeBridge, table, {
        key: `in.(${nativeRefundIds.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE).join(",")})`,
      })));
    const evidenceHashes = new Map(evidence.map(row => [String(row.key), row.value]));
    for (const row of nativeDeposits) if (evidenceHashes.has(String(row.key))) row.value.refundEvidenceHash = evidenceHashes.get(String(row.key));
    const hashes = new Map(proposals.map(row => [String(row.key), row.value]));
    for (const row of nativeDeposits) if (hashes.has(String(row.key))) row.value.refundProposalHash = hashes.get(String(row.key));
  }
  const items = buildBridgeReviewQueue({ deposits, withdrawals, reviews, nativeDeposits, nativeWithdrawals, legacyDeposits: [], legacyWithdrawals: [] });
  const chains = new Map((await readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "chains", {})).map(row => [String(row.key), row.value]));
  for (const item of items.filter(item => item.source === "eab" && item.actions.includes("refund") && item.kind !== "withdrawal_refund")) {
    const vault = chains.get(item.chainId)?.vault;
    if (typeof vault === "string" && /^(0x)?[a-f0-9]{40}$/i.test(vault) && !/^(0x)?0+$/.test(vault)) item.refundVault = vault.replace(/^0x/i, "").toLowerCase();
    else item.actions = item.actions.filter(action => action !== "refund");
  }
  const digests = new Map<string, Promise<string>>();
  const depositDigest = (item: BridgeReviewItem) => {
    if (!digests.has(item.id)) {
      const [, , chainId, router, depositId] = item.id.split(":");
      digests.set(item.id, getReviewDigest(accessToken, "getReviewedDepositDigest(uint256,address,uint256)", [chainId, `0x${router.replace(/^0x/i, "")}`, depositId]));
    }
    return digests.get(item.id)!;
  };
  const depositReviews = items.filter(item => item.source === "eab" && item.kind === "deposit_review");
  const refunds = items.filter(item => item.kind === "withdrawal_refund");
  await Promise.all([
    enrichDepositApprovals(accessToken, depositReviews, depositDigest),
    enrichRefundReadiness(accessToken, refunds),
  ]);
  if (userAddress) await enrichReviewGovernance(accessToken, items, userAddress, depositDigest);
  return items;
};

const enrichDepositApprovals = async (
  accessToken: string,
  items: BridgeReviewItem[],
  depositDigest: (item: BridgeReviewItem) => Promise<string>,
): Promise<void> => {
  const approvals = new Map<string, unknown>();
  try {
    for (let offset = 0; offset < items.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
      const batch = items.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE);
      const rows = await readReviewRows(accessToken, constants.ExternalAssetBridge, constants.externalAssetBridge, "depositReviewApprovals", {
        or: `(${batch.map(item => {
          const [, , chainId, router, depositId] = item.id.split(":");
          return `and(key.eq.${chainId},key2.eq.${router.replace(/^0x/i, "").toLowerCase()},key3.eq.${depositId})`;
        }).join(",")})`,
        select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc",
      });
      for (const row of rows) approvals.set(`${row.key}:${row.key2?.toLowerCase()}:${row.key3}`, row.value);
    }
  } catch {
    for (const item of items) item.approvalStatus = "unavailable";
    return;
  }
  await Promise.all(items.map(async item => {
    const [, , chainId, router, depositId] = item.id.split(":");
    const approval = approvals.get(`${chainId}:${router.toLowerCase()}:${depositId}`);
    item.approvalStatus = "pending";
    if (typeof approval !== "string" || !/^(0x)?[0-9a-f]{64}$/i.test(approval) || /^(0x)?0+$/i.test(approval)) return;
    try {
      if (`0x${approval.replace(/^0x/i, "").toLowerCase()}` !== await depositDigest(item)) return;
      item.approvalStatus = "approved";
      item.reason = "Approved. The bridge automatically retries settlement; the transfer is not completed until settlement succeeds.";
    } catch { item.approvalStatus = "unavailable"; }
  }));
};

const enrichRefundReadiness = async (accessToken: string, items: BridgeReviewItem[]): Promise<void> => {
  if (!items.length) return;
  let threshold: number;
  try { threshold = await getSettlementVerifierThreshold(accessToken); }
  catch { for (const item of items) item.refundStatus = "unavailable"; return; }
  for (let offset = 0; offset < items.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    await Promise.all(items.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE).map(async item => {
      try {
        const digest = await getReviewDigest(accessToken, "getWithdrawalRefundDigest(uint256)", [item.reference]);
        item.refundStatus = await hasRefundQuorum(accessToken, digest, threshold) ? "ready" : "pending";
      } catch { item.refundStatus = "unavailable"; }
    }));
  }
};

const enrichReviewGovernance = async (
  accessToken: string, items: BridgeReviewItem[], userAddress: string,
  depositDigest: (item: BridgeReviewItem) => Promise<string>,
): Promise<void> => {
  const reviews = items.filter(item => item.source !== "legacy" && item.actions.length > 0);
  if (!reviews.length) return;
  const { AdminRegistry, externalAssetBridge, stratoNativeBridge } = constants;
  const normalize = (address: string) => address.toLowerCase().replace(/^0x/, "");
  try {
    const [registry, admins, thresholds, active] = await Promise.all([
      cirrus.get(accessToken, `/${AdminRegistry}`, { params: { address: `eq.${adminRegistry}`, select: "defaultVotingThresholdBps", limit: 1 } }),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "admins", {}),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "votingThresholds", { key: `in.(${[externalAssetBridge, stratoNativeBridge].filter(Boolean).join(",")})`, select: "key,key2,value", order: "key.asc,key2.asc" }),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "currentIssues", { value: "eq.true" }),
    ]);
    const adminCount = new Set(admins.map(row => String(row.value)).filter(value => /^(0x)?[0-9a-f]{40}$/i.test(value) && !/^(0x)?0+$/i.test(value)).map(normalize)).size;
    const defaultBps = Number(registry.data?.[0]?.defaultVotingThresholdBps);
    if (!adminCount || !Number.isSafeInteger(defaultBps) || defaultBps < 1 || defaultBps > 10000) throw new Error("Voting configuration unavailable");
    for (const item of reviews) {
      item.governance = {};
      for (const action of item.actions) {
        const override = Number(thresholds.find(row => normalize(row.key) === normalize(item.source === "native" ? stratoNativeBridge : externalAssetBridge) && row.key2 === bridgeReviewFunction(item, action))?.value ?? 0);
        const bps = override === 0 ? defaultBps : override;
        if (!Number.isSafeInteger(bps) || bps < 1 || bps > 10000) throw new Error("Voting threshold unavailable");
        item.governance[action] = { votesCast: 0, votesRequired: Math.ceil(adminCount * bps / 10000), hasVoted: false };
      }
    }
    const ids = [...new Set(active.filter(row => row.value === true || row.value === "true").map(row => row.key))];
    if (ids.some(id => !/^(0x)?[a-f0-9]{64}$/i.test(id))) throw new Error("Invalid governance issue identifier");
    const byId = new Map(reviews.map(item => [item.id, item]));
    for (let offset = 0; offset < ids.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
      const batch = ids.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE);
      const events = await readReviewRows(accessToken, AdminRegistry, adminRegistry, "IssueCreated", {
        issueId: `in.(${batch.join(",")})`, target: `in.(${[externalAssetBridge, stratoNativeBridge].filter(Boolean).join(",")})`,
        func: "in.(approveReviewedDeposit,rejectDepositNoFunds,abortDeposit,refundWithdrawal,authorizeDepositDelivery,reopenDeposit,requestDepositRefund,finalizeDepositRefund,requestWithdrawalCancellation,refundCanceledWithdrawal)", select: "issueId,target,func,args", order: "issueId.asc,block_number.desc",
      }) as unknown as Array<{ issueId: string; target: string; func: string; args: unknown }>;
      const matched = await Promise.all(events.map(async event => {
        if (!batch.includes(event.issueId)) return undefined;
        const match = parseBridgeReviewIssue(event.func, event.args);
        const item = match && byId.get(match.id);
        if (!match || !item || !item.governance?.[match.action] || normalize(event.target) !== normalize(item.source === "native" ? stratoNativeBridge : externalAssetBridge) || event.func !== bridgeReviewFunction(item, match.action)) return undefined;
        if (event.func === "approveReviewedDeposit" && match.digest !== await depositDigest(item)) return undefined;
        if (match.vault && match.vault !== item.refundVault) return undefined;
        if (match.refundEvidenceHash && match.refundEvidenceHash !== normalize(item.refundEvidenceHash || "")) return undefined;
        return { event, item, action: match.action };
      }));
      const matchedIds = [...new Set(matched.flatMap(match => match ? [match.event.issueId] : []))];
      if (!matchedIds.length) continue;
      const votes = await readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "votes", { key: `in.(${matchedIds.join(",")})`, select: "key,key2,value", order: "key.asc,key2.asc" });
      for (const match of matched) {
        if (!match) continue;
        const voters = new Set(votes.filter(row => row.key === match.event.issueId && /^(0x)?[a-f0-9]{40}$/i.test(String(row.value)) && !/^(0x)?0+$/i.test(String(row.value))).map(row => normalize(String(row.value))));
        match.item.governance![match.action] = { ...match.item.governance![match.action]!, issueId: match.event.issueId,
          votesCast: voters.size, hasVoted: voters.has(normalize(userAddress)) };
      }
    }
    for (const item of reviews) item.governanceStatus = "available";
  } catch {
    for (const item of reviews) { item.governanceStatus = "unavailable"; delete item.governance; }
  }
};

// Read the contract's digest so the app need not duplicate bridge cryptography.
const getReviewDigest = async (accessToken: string, signature: string, args: string[]): Promise<string> => {
  if (!nodeUrl) throw new Error("STRATO node URL is unavailable");
  const { data } = await axios.post(`${nodeUrl.replace(/\/$/, "")}/rpc`, {
    jsonrpc: "2.0", id: 1, method: "eth_call",
    params: [{ to: `0x${constants.externalAssetBridge.replace(/^0x/i, "")}`, data: buildBridgeDigestCall(signature, args) }, "latest"],
  }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 60_000 });
  return parseBridgeDigest(data);
};

const getSettlementVerifierThreshold = async (accessToken: string): Promise<number> => {
  const address = `eq.${constants.externalAssetBridge}`;
  const bridge = await cirrus.get(accessToken, `/${constants.ExternalAssetBridge}`, { params: { address, select: "settlementVerifierThreshold", limit: 1 } });
  const threshold = Number(bridge.data?.[0]?.settlementVerifierThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 2) throw new StratoError("Refund attestation state is unavailable", 409);
  return threshold;
};

const hasRefundQuorum = async (accessToken: string, digest: string, threshold: number): Promise<boolean> => {
  const address = `eq.${constants.externalAssetBridge}`;
  const attestations = await cirrus.get(accessToken, `/${constants.ExternalAssetBridge}-settlementAttestationCounts`, { params: {
    address, or: `(key.eq.${digest},key.eq.${digest.slice(2)})`, select: "value", limit: 1,
  } });
  const count = Number(attestations.data?.[0]?.value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new StratoError("Refund attestation state is unavailable", 409);
  }
  return count >= threshold;
};

const getAdminBridgeReviewItem = async (accessToken: string, id: string): Promise<BridgeReviewItem | undefined> => {
  const [source, kind, ...parts] = id.split(":");
  const records: BridgeReviewRecords = { deposits: [], withdrawals: [], reviews: [], nativeDeposits: [], nativeWithdrawals: [], legacyDeposits: [], legacyWithdrawals: [] };
  let eabChain: BridgeReviewRow | undefined;
  const readOne = async (contract: string, address: string, table: string, params: Record<string, string>) => {
    const { data } = await cirrus.get(accessToken, `/${contract}-${table}`, { params: {
      address: `eq.${address}`, order: "key.asc", offset: 0, ...params, limit: 1,
    } });
    if (!Array.isArray(data)) throw new Error("Invalid bridge review response from Cirrus");
    return data[0] as BridgeReviewRow | undefined;
  };
  if (source === "eab" && kind === "deposit" && parts.length === 3) {
    const [chainId, router, depositId] = parts;
    const [deposit, chain] = await Promise.all([
      readOne(constants.ExternalAssetBridge, constants.externalAssetBridge, "deposits",
        { key: `eq.${chainId}`, key2: `eq.${router}`, key3: `eq.${depositId}`, select: "key,key2,key3,value" }),
      readOne(constants.ExternalAssetBridge, constants.externalAssetBridge, "chains", { key: `eq.${chainId}`, select: "key,value" }),
    ]);
    if (deposit) records.deposits.push(deposit);
    eabChain = chain;
  } else if (source === "eab" && kind === "withdrawal" && parts.length === 1) {
    const [withdrawal, review] = await Promise.all([
      readOne(constants.ExternalAssetBridge, constants.externalAssetBridge, "withdrawals", { key: `eq.${parts[0]}`, select: "key,value" }),
      readOne(constants.ExternalAssetBridge, constants.externalAssetBridge, "withdrawalManualReviews", { key: `eq.${parts[0]}`, select: "key,value" }),
    ]);
    if (withdrawal) records.withdrawals.push(withdrawal);
    if (review) records.reviews.push(review);
  } else if (source === "native" && kind === "deposit" && parts.length === 2) {
    const [chainId, depositId] = parts;
    const [deposit, proposal, evidence] = await Promise.all([
      readOne(constants.StratoNativeBridge, constants.stratoNativeBridge, "deposits",
        { key: `eq.${chainId}`, ...(depositId ? { key2: `eq.${depositId}` } : {}), select: "key,key2,value" }),
      readOne(constants.StratoNativeBridge, constants.stratoNativeBridge, "depositRefundProposals", { key: `eq.${chainId}`, select: "key,value" }),
      readOne(constants.StratoNativeBridge, constants.stratoNativeBridge, "depositRefundEvidence", { key: `eq.${chainId}`, select: "key,value" }),
    ]);
    if (deposit) {
      if (proposal) deposit.value.refundProposalHash = proposal.value;
      if (evidence) deposit.value.refundEvidenceHash = evidence.value;
      records.nativeDeposits.push(deposit);
    }
  } else if (source === "native" && kind === "withdrawal" && parts.length === 1) {
    const withdrawal = await readOne(constants.StratoNativeBridge, constants.stratoNativeBridge, "withdrawals", { key: `eq.${parts[0]}`, select: "key,value" });
    if (withdrawal) records.nativeWithdrawals.push(withdrawal);
  } else return undefined;
  const item = buildBridgeReviewQueue(records).find(entry => entry.id === id);
  if (item?.source === "eab" && item.actions.includes("refund") && item.kind !== "withdrawal_refund") {
    const vault = eabChain?.value?.vault;
    if (typeof vault === "string" && /^(0x)?[a-f0-9]{40}$/i.test(vault) && !/^(0x)?0+$/.test(vault)) item.refundVault = vault.replace(/^0x/i, "").toLowerCase();
    else item.actions = item.actions.filter(action => action !== "refund");
  }
  return item;
};

export const prepareAdminBridgeReview = async (accessToken: string, id: string, action: string): Promise<BridgeReviewVote> => {
  if (!["approve", "reject", "refund", "confirm_refund", "cancel_withdrawal", "confirm_cancellation"].includes(action)) throw new StratoError("Review action is unavailable; settlement is handled automatically by the bridge", 409);
  const item = await getAdminBridgeReviewItem(accessToken, id);
  if (!item || !item.actions.some(allowed => allowed === action)) throw new StratoError("Review action is unavailable; refresh the queue", 409);
  const target = item.source === "native" ? constants.stratoNativeBridge : constants.externalAssetBridge;
  if (action === "cancel_withdrawal" || action === "confirm_cancellation") {
    if (item.source !== "native") throw new StratoError("Native cancellation is unavailable", 409);
    if (action === "confirm_cancellation" && !item.refundEvidenceHash) throw new StratoError("Cancellation evidence is unavailable", 409);
    return { target, func: action === "cancel_withdrawal" ? "requestWithdrawalCancellation" : "refundCanceledWithdrawal",
      args: action === "cancel_withdrawal" ? [item.reference] : [item.reference, item.refundEvidenceHash!] };
  }
  if (action === "reject") {
    if (item.source === "native") return { target, func: "rejectDepositNoFunds", args: [item.reference] };
    const [, , chainId, router, depositId] = id.split(":");
    return { target, func: "rejectDepositNoFunds", args: [chainId, `0x${router.replace(/^0x/i, "")}`, depositId] };
  }
  if (action === "confirm_refund") {
    if (item.source !== "native" || !item.refundEvidenceHash) throw new StratoError("Native refund evidence is unavailable", 409);
    return { target, func: "finalizeDepositRefund", args: [item.reference, item.refundEvidenceHash] };
  }
  if (item.source === "native") return { target, func: bridgeReviewFunction(item, action as "approve" | "refund"), args: [item.reference] };
  if (item.kind === "deposit_recovery" || (item.kind === "deposit_review" && action === "refund")) {
    const [, , chainId, router, depositId] = id.split(":");
    const args = [chainId, `0x${router.replace(/^0x/i, "")}`, depositId];
    if (action === "refund") {
      if (!item.refundVault) throw new StratoError("Refund vault is unavailable", 409);
      args.push(`0x${item.refundVault}`);
    }
    return { target, func: bridgeReviewFunction(item, action as "approve" | "refund"), args };
  }
  if (item.kind === "deposit_review") {
    const [, , chainId, router, depositId] = id.split(":");
    const args = [chainId, `0x${router.replace(/^0x/i, "")}`, depositId];
    const digest = await getReviewDigest(accessToken, "getReviewedDepositDigest(uint256,address,uint256)", args);
    return { target, func: "approveReviewedDeposit", args: [...args, digest] };
  }
  const signature = "getWithdrawalRefundDigest(uint256)";
  const args = [item.reference];
  const digest = await getReviewDigest(accessToken, signature, args);
  if (!await hasRefundQuorum(accessToken, digest, await getSettlementVerifierThreshold(accessToken))) {
    throw new StratoError("Awaiting verifier attestations. The bridge prepares refund evidence automatically; refresh before voting", 409);
  }
  if (await getReviewDigest(accessToken, signature, args) !== digest) {
    throw new StratoError("Refund evidence changed; refresh before voting", 409);
  }
  return { target, func: "refundWithdrawal", args };
};

export const getAdminBridgePolicies = async (accessToken: string): Promise<BridgePolicyOverview> => {
  const { ExternalAssetBridge, externalAssetBridge, StratoNativeBridge, stratoNativeBridge, StratoNativeCustodyVault, Token } = constants;
  const read = <T = BridgeReviewRow>(contract: string, address: string, table: string, filters: Record<string, string> = {}) =>
    readReviewRows<T>(accessToken, contract, address, table, filters, true);
  const root = async (contract: string, address: string, select: string) => {
    if (!address) return undefined;
    const { data } = await cirrus.get(accessToken, `/${contract}`, { transformResponse: [parseBridgePolicyJson], params: { address: `eq.${address}`, select, limit: 1 } });
    if (!Array.isArray(data) || !data[0]) throw new Error("Bridge policy state unavailable");
    return data[0] as Record<string, unknown>;
  };
  const [eab, native] = await Promise.all([
    root(ExternalAssetBridge, externalAssetBridge, "depositsPaused,withdrawalsPaused"),
    root(StratoNativeBridge, stratoNativeBridge, "depositsPaused,withdrawalsPaused,custodyVault"),
  ]);
  const custodyAddress = typeof native?.custodyVault === "string" && /^(0x)?[0-9a-f]{40}$/i.test(native.custodyVault) &&
    !/^(0x)?0+$/i.test(native.custodyVault) ? native.custodyVault.replace(/^0x/i, "").toLowerCase() : "";
  const [routes, chains, mintPolicies, actions, ethAutoRoute, nativeAssets, nativeConfigs, nativeAutoRoute, locked, custody] = await Promise.all([
    read(ExternalAssetBridge, externalAssetBridge, "routes", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc" }),
    read(ExternalAssetBridge, externalAssetBridge, "chains", {}),
    read(ExternalAssetBridge, externalAssetBridge, "mintPolicies", {}),
    read(ExternalAssetBridge, externalAssetBridge, "depositActionConfigs", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc" }),
    read<BridgeReviewRow<unknown>>(ExternalAssetBridge, externalAssetBridge, "nativeAutoRouteEnabled", { select: "key,key2,value", order: "key.asc,key2.asc" }),
    read(StratoNativeBridge, stratoNativeBridge, "assets", { select: "key,key2,value", order: "key.asc,key2.asc" }),
    read(StratoNativeBridge, stratoNativeBridge, "tokenBridgeConfigs", {}),
    read<BridgeReviewRow<unknown>>(StratoNativeBridge, stratoNativeBridge, "autoRouteEnabled", { select: "key,key2,value", order: "key.asc,key2.asc" }),
    read<BridgeReviewRow<unknown>>(StratoNativeCustodyVault, custodyAddress, "lockedBalance", {}),
    root(StratoNativeCustodyVault, custodyAddress, "paused"),
  ]);
  const records: BridgePolicyRecords = { eab, native, custody, routes, chains, mintPolicies, actions, ethAutoRoute, nativeAssets, nativeConfigs, nativeAutoRoute, locked, tokens: [] };
  const addresses = [...new Set([...routes.map(row => row.key3!), ...nativeAssets.map(row => row.key), ...mintPolicies.map(row => row.key)]
    .map(address => address.toLowerCase().replace(/^0x/, "")))];
  if (addresses.some(address => !/^[0-9a-f]{40}$/.test(address))) throw new Error("Invalid bridge policy token");
  for (let offset = 0; offset < addresses.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    const batch = addresses.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE);
    records.tokens.push(...await read<BridgePolicyRecords["tokens"][number]>(Token, batch[0], "", {
      address: `in.(${batch.join(",")})`, select: "address,_symbol,customDecimals", order: "address.asc",
    }));
  }
  return { items: buildBridgePolicyRows(records), fetchedAt: Date.now(),
    unconfigured: [...(!externalAssetBridge ? ["eab" as const] : []), ...(!stratoNativeBridge ? ["native" as const] : [])] };
};

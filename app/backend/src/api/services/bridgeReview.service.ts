import { BridgePolicyOverview, BridgePolicyRecords, buildBridgeReviewQueue, BridgeReviewItem, BridgeReviewRow, BridgeReviewVote } from "@strato/shared-types";
import axios from "axios";
import { nodeUrl, adminRegistry } from "../../config/config";
import { constants, BRIDGE_REVIEW_PAGE_SIZE, BRIDGE_REVIEW_ID_BATCH_SIZE } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import { StratoError } from "../../errors";
import { buildBridgePolicyRows, parseBridgePolicyJson, buildBridgeDigestCall, parseBridgeDigest, parseBridgeReviewIssue } from "../helpers/bridge.helper";
import { requestBridgeOperation } from "./bridge.service";

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
  const { ExternalAssetBridge, externalAssetBridge, StratoNativeBridge, stratoNativeBridge, MercataBridge, mercataBridge } = constants;
  const [deposits, withdrawals, nativeDeposits, nativeWithdrawals, legacyDeposits, legacyWithdrawals] = await Promise.all([
    readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "deposits", { select: "key,key2,key3,value", order: "key.asc,key2.asc,key3.asc", "value->>status": "eq.2" }),
    readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "withdrawals", { "value->>status": "in.(2,3)" }),
    readReviewRows(accessToken, StratoNativeBridge, stratoNativeBridge, "deposits", { "value->>bridgeStatus": "eq.2" }),
    readReviewRows(accessToken, StratoNativeBridge, stratoNativeBridge, "withdrawals", { "value->>bridgeStatus": "eq.2", "value->>useInstantPath": "eq.false" }),
    readReviewRows(accessToken, MercataBridge, mercataBridge, "deposits", { select: "key,key2,value", order: "key.asc,key2.asc", "value->>bridgeStatus": "eq.2" }),
    readReviewRows(accessToken, MercataBridge, mercataBridge, "withdrawals", { "value->>bridgeStatus": "eq.2" }),
  ]);
  const ids = withdrawals.filter(row => String(row.value.status) === "2").map(row => row.key);
  const reviews: BridgeReviewRow[] = [];
  for (let offset = 0; offset < ids.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    reviews.push(...await readReviewRows(accessToken, ExternalAssetBridge, externalAssetBridge, "withdrawalManualReviews", {
      key: `in.(${ids.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE).join(",")})`,
    }));
  }
  const items = buildBridgeReviewQueue({ deposits, withdrawals, reviews, nativeDeposits, nativeWithdrawals, legacyDeposits, legacyWithdrawals });
  const digests = new Map<string, Promise<string>>();
  const depositDigest = (item: BridgeReviewItem) => {
    if (!digests.has(item.id)) {
      const [, , chainId, router, depositId] = item.id.split(":");
      digests.set(item.id, getReviewDigest(accessToken, "getReviewedDepositDigest(uint256,address,uint256)", [chainId, `0x${router.replace(/^0x/i, "")}`, depositId]));
    }
    return digests.get(item.id)!;
  };
  const depositReviews = items.filter(item => item.source === "eab" && item.kind === "deposit_review");
  for (let offset = 0; offset < depositReviews.length; offset += BRIDGE_REVIEW_ID_BATCH_SIZE) {
    await Promise.all(depositReviews.slice(offset, offset + BRIDGE_REVIEW_ID_BATCH_SIZE).map(async item => {
      const [, , chainId, router, depositId] = item.id.split(":");
      let approved = false;
      item.approvalStatus = "pending";
      try {
        const { data } = await cirrus.get(accessToken, `/${ExternalAssetBridge}-depositReviewApprovals`, { params: {
          address: `eq.${externalAssetBridge}`, key: `eq.${chainId}`, key2: `eq.${router.replace(/^0x/i, "").toLowerCase()}`,
          key3: `eq.${depositId}`, select: "value", limit: 1,
        } });
        const approval = data?.[0]?.value;
        approved = typeof approval === "string" && /^(0x)?[0-9a-f]{64}$/i.test(approval) &&
          !/^(0x)?0+$/i.test(approval) && `0x${approval.replace(/^0x/i, "").toLowerCase()}` ===
          await depositDigest(item);
      } catch {
        item.approvalStatus = "unavailable";
        // Keep the review visible, but never offer settlement on an unverified approval.
      }
      if (approved) { item.approvalStatus = "approved"; item.reason = "Approved. The bridge automatically retries settlement; the transfer is not completed until settlement succeeds."; }
      if (!approved) item.actions = item.actions.filter(action => action !== "settle");
    }));
  }
  if (userAddress) await enrichReviewGovernance(accessToken, items, userAddress, depositDigest);
  return items;
};

const enrichReviewGovernance = async (
  accessToken: string, items: BridgeReviewItem[], userAddress: string,
  depositDigest: (item: BridgeReviewItem) => Promise<string>,
): Promise<void> => {
  const reviews = items.filter(item => item.source === "eab" && item.actions.some(action => action !== "settle"));
  if (!reviews.length) return;
  const { AdminRegistry, externalAssetBridge } = constants;
  const normalize = (address: string) => address.toLowerCase().replace(/^0x/, "");
  try {
    const [registry, admins, thresholds, active] = await Promise.all([
      cirrus.get(accessToken, `/${AdminRegistry}`, { params: { address: `eq.${adminRegistry}`, select: "defaultVotingThresholdBps", limit: 1 } }),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "admins", {}),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "votingThresholds", { key: `eq.${externalAssetBridge}`, select: "key,key2,value", order: "key.asc,key2.asc" }),
      readReviewRows<BridgeReviewRow<unknown>>(accessToken, AdminRegistry, adminRegistry, "currentIssues", { value: "eq.true" }),
    ]);
    const adminCount = new Set(admins.map(row => String(row.value)).filter(value => /^(0x)?[0-9a-f]{40}$/i.test(value) && !/^(0x)?0+$/i.test(value)).map(normalize)).size;
    const defaultBps = Number(registry.data?.[0]?.defaultVotingThresholdBps);
    if (!adminCount || !Number.isSafeInteger(defaultBps) || defaultBps < 1 || defaultBps > 10000) throw new Error("Voting configuration unavailable");
    const functions = { approve: "approveReviewedDeposit", reject: "abortDeposit", refund: "refundWithdrawal" };
    for (const item of reviews) {
      item.governance = {};
      for (const action of item.actions) {
        if (action === "settle") continue;
        const override = Number(thresholds.find(row => normalize(row.key) === normalize(externalAssetBridge) && row.key2 === functions[action])?.value ?? 0);
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
        issueId: `in.(${batch.join(",")})`, target: `eq.${externalAssetBridge}`,
        func: "in.(approveReviewedDeposit,abortDeposit,refundWithdrawal)", select: "issueId,target,func,args", order: "issueId.asc,block_number.desc",
      }) as unknown as Array<{ issueId: string; target: string; func: string; args: unknown }>;
      const matched = await Promise.all(events.map(async event => {
        if (!batch.includes(event.issueId) || normalize(event.target) !== normalize(externalAssetBridge)) return undefined;
        const match = parseBridgeReviewIssue(event.func, event.args);
        const item = match && byId.get(match.id);
        if (!match || !item || !item.governance?.[match.action]) return undefined;
        if (match.action === "approve" && match.digest !== await depositDigest(item)) return undefined;
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

const hasRefundQuorum = async (accessToken: string, digest: string): Promise<boolean> => {
  const address = `eq.${constants.externalAssetBridge}`;
  const [bridge, attestations] = await Promise.all([
    cirrus.get(accessToken, `/${constants.ExternalAssetBridge}`, { params: { address, select: "settlementVerifierThreshold", limit: 1 } }),
    cirrus.get(accessToken, `/${constants.ExternalAssetBridge}-settlementAttestationCounts`, { params: {
      address, or: `(key.eq.${digest},key.eq.${digest.slice(2)})`, select: "value", limit: 1,
    } }),
  ]);
  const threshold = Number(bridge.data?.[0]?.settlementVerifierThreshold);
  const count = Number(attestations.data?.[0]?.value ?? 0);
  if (!Number.isSafeInteger(threshold) || threshold < 2 || !Number.isSafeInteger(count) || count < 0) {
    throw new StratoError("Refund attestation state is unavailable", 409);
  }
  return count >= threshold;
};

export const prepareAdminBridgeReview = async (accessToken: string, id: string, action: string): Promise<BridgeReviewVote | { transactionHash: string }> => {
  const item = (await getAdminBridgeReviews(accessToken)).find(entry => entry.id === id);
  if (item?.kind === "deposit_review" && action === "settle" && !item.actions.includes("settle")) {
    throw new StratoError("Settlement requires a matching governance approval; refresh the queue after approval completes", 409);
  }
  if (!item || !item.actions.some(allowed => allowed === action)) throw new StratoError("Review action is unavailable; refresh the queue", 409);
  const target = constants.externalAssetBridge;
  if (item.kind === "deposit_review") {
    if (action === "settle") {
      const result = await requestBridgeOperation({ id, action });
      if (!result.transactionHash) throw new StratoError("Bridge did not return a settlement transaction", 409);
      return { transactionHash: result.transactionHash };
    }
    const [, , chainId, router, depositId] = id.split(":");
    const args = [chainId, `0x${router.replace(/^0x/i, "")}`, depositId];
    if (action === "reject") return { target, func: "abortDeposit", args };
    const digest = await getReviewDigest(accessToken, "getReviewedDepositDigest(uint256,address,uint256)", args);
    return { target, func: "approveReviewedDeposit", args: [...args, digest] };
  }
  const signature = "getWithdrawalRefundDigest(uint256)";
  const args = [item.reference];
  const digest = await getReviewDigest(accessToken, signature, args);
  if (!await hasRefundQuorum(accessToken, digest)) {
    const result = await requestBridgeOperation({ id, action: "refund" });
    if (result.digest?.toLowerCase() !== digest || await getReviewDigest(accessToken, signature, args) !== digest ||
        !await hasRefundQuorum(accessToken, digest)) {
      throw new StratoError("Refund evidence changed or is not indexed yet; refresh before voting", 409);
    }
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
    root(StratoNativeBridge, stratoNativeBridge, "depositsPaused,withdrawalsPaused,custodyVault,INSTANT_WITHDRAWAL_DELAY_SECONDS"),
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

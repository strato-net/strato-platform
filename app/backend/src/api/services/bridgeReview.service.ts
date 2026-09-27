import { buildBridgeReviewQueue, BridgeReviewItem, BridgeReviewRow, BridgeReviewVote } from "@strato/shared-types";
import axios from "axios";
import { nodeUrl } from "../../config/config";
import { constants, BRIDGE_REVIEW_PAGE_SIZE, BRIDGE_REVIEW_ID_BATCH_SIZE } from "../../config/constants";
import { cirrus } from "../../utils/appApiHelper";
import { StratoError } from "../../errors";
import { buildBridgeDigestCall, parseBridgeDigest } from "../helpers/bridge.helper";
import { requestBridgeOperation } from "./bridge.service";

const readReviewRows = async (accessToken: string, contract: string, address: string, table: string, filters: Record<string, string>): Promise<BridgeReviewRow[]> => {
  if (!address) return [];
  const rows: BridgeReviewRow[] = [];
  for (;;) {
    const { data } = await cirrus.get(accessToken, `/${contract}-${table}`, { params: {
      address: `eq.${address}`, select: "key,value", order: "key.asc", ...filters,
      limit: BRIDGE_REVIEW_PAGE_SIZE, offset: rows.length,
    } });
    if (!Array.isArray(data)) throw new Error("Invalid bridge review response from Cirrus");
    if (!data.length) return rows;
    rows.push(...data);
  }
};

export const getAdminBridgeReviews = async (accessToken: string): Promise<BridgeReviewItem[]> => {
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
  return buildBridgeReviewQueue({ deposits, withdrawals, reviews, nativeDeposits, nativeWithdrawals, legacyDeposits, legacyWithdrawals });
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

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getChainProvider } from "./rpcService";
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Signature,
  TypedDataEncoder,
  keccak256,
  verifyTypedData,
} from "ethers";
import { OperationType } from "@safe-global/types-kit";
import axios from "axios";
import {
  config,
  VERIFIER_REQUEST_TIMEOUT_MS,
  EXTERNAL_BRIDGE_LOG_BLOCK_RANGE,
  getExternalBridgeExecutorKmsConfig,
  getExternalBridgeVerifierApiTokens,
  getExternalBridgeVerifierUrls,
} from "../config";
import { PersistedWithdrawalReview, WithdrawalInfo } from "../types";
import { ensureHexPrefix, safeChecksum } from "../utils/utils";
import { fetch as http, retry } from "../utils/api";
import { initializeSafeForChain } from "../utils/safeHelper";
import { DigestKmsSigner } from "../utils/kmsSigner";
import { logError } from "../utils/logger";

export interface WithdrawalAuthorization {
  sourceChainId: string;
  sourceBridge: string;
  sourceWithdrawalId: string;
  destinationChainId: string;
  destinationVault: string;
  token: string;
  recipient: string;
  amount: string;
  notBefore: string;
  deadline: string;
  signerSetVersion: string;
}

export interface WithdrawalReview {
  sourceChainId: string;
  sourceBridge: string;
  sourceWithdrawalId: string;
  destinationChainId: string;
  destinationVault: string;
  token: string;
  recipient: string;
  amount: string;
}

const EXTERNAL_VAULT_ABI = [
  "function withdrawalCapacity(address token,uint256 amount) view returns (uint256 available,uint256 retryAfterSeconds)",
  "function attestationThreshold() view returns (uint8)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
  "function signerSetVersion() view returns (uint256)",
  "function approveLargeWithdrawal(bytes32 reviewDigest,uint256 approvalDeadline)",
  "function reservations(bytes32) view returns (uint8 status,address token,address recipient,uint256 amount,uint256 deadline,bytes32 authorizationDigest)",
  "function reserve((uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId,uint256 destinationChainId,address destinationVault,address token,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 signerSetVersion) authorization,bytes[] signatures) returns (bytes32)",
  "function release(bytes32 reservationId)",
  "function cancelExpired(bytes32 reservationId)",
  "event WithdrawalReserved(bytes32 indexed reservationId,bytes32 indexed authorizationDigest,uint256 indexed sourceWithdrawalId,address token,address recipient,uint256 amount,uint256 deadline)",
  "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
  "event WithdrawalCancelled(bytes32 indexed reservationId)",
];

const WITHDRAWAL_AUTHORIZATION_TYPES = {
  WithdrawalAuthorization: [
    { name: "sourceChainId", type: "uint256" },
    { name: "sourceBridge", type: "address" },
    { name: "sourceWithdrawalId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "destinationVault", type: "address" },
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "notBefore", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "signerSetVersion", type: "uint256" },
  ],
};

const WITHDRAWAL_REVIEW_TYPES = {
  WithdrawalReview: WITHDRAWAL_AUTHORIZATION_TYPES.WithdrawalAuthorization.slice(
    0,
    8,
  ),
};

const vaultInterface = new Interface(EXTERNAL_VAULT_ABI);
const pendingReviewProposals = new Map<string, ReturnType<typeof createWithdrawalReviewProposal>>();

const authorizationDomain = (authorization: WithdrawalAuthorization) => ({
  name: "ExternalBridgeVault",
  version: "1",
  chainId: BigInt(authorization.destinationChainId),
  verifyingContract: authorization.destinationVault,
});

const reviewDomain = (review: WithdrawalReview) => ({
  name: "ExternalBridgeVault",
  version: "1",
  chainId: BigInt(review.destinationChainId),
  verifyingContract: review.destinationVault,
});

export const buildWithdrawalReview = (
  withdrawal: WithdrawalInfo,
  sourceChainId: bigint,
  sourceBridgeAddress: string,
): WithdrawalReview => {
  if (!withdrawal.vault) {
    throw new Error(`Withdrawal ${withdrawal.withdrawalId} is missing its vault`);
  }
  return {
    sourceChainId: sourceChainId.toString(),
    sourceBridge: safeChecksum(sourceBridgeAddress),
    sourceWithdrawalId: withdrawal.withdrawalId,
    destinationChainId: withdrawal.externalChainId.toString(),
    destinationVault: safeChecksum(withdrawal.vault),
    token: safeChecksum(withdrawal.externalToken),
    recipient: safeChecksum(withdrawal.externalRecipient),
    amount: withdrawal.externalTokenAmount,
  };
};

export const getWithdrawalReviewDigest = (review: WithdrawalReview): string =>
  TypedDataEncoder.hash(
    reviewDomain(review),
    WITHDRAWAL_REVIEW_TYPES,
    review,
  );

export const getExternalChainLatestTimestamp = async (
  chainId: string | number,
): Promise<bigint> => {
  const provider = getChainProvider(BigInt(chainId));
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error(`Latest block not found for chain ${chainId}`);
  }
  return BigInt(latestBlock.timestamp);
};

const createWithdrawalReviewProposal = async (
  review: WithdrawalReview,
): Promise<{
  reviewDigest: string;
  approvalDeadline: string;
  proposalHash: string;
}> => {
  const chainId = Number(review.destinationChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(
      `Unsupported external review chain id: ${review.destinationChainId}`,
    );
  }
  const provider = getChainProvider(chainId);
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error(`Latest block not found for chain ${chainId}`);
  }
  const approvalDeadline =
    BigInt(latestBlock.timestamp) +
    BigInt(config.externalAssetBridge.manualReviewValiditySeconds);
  const reviewDigest = getWithdrawalReviewDigest(review);
  const safeAddress = config.safe.address || "";
  const relayer = config.safe.safeProposerAddress || "";
  const { protocolKit, apiKit } = await initializeSafeForChain(
    chainId,
    safeAddress,
  );
  const journalPath = path.join(process.cwd(), "data", "safe-reviews", `${chainId}-${safeAddress.toLowerCase()}-${reviewDigest}.json`);
  let saved: PersistedWithdrawalReview | undefined;
  try {
    saved = JSON.parse(await fs.readFile(journalPath, "utf8"));
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  if (saved) {
    if (saved.reviewDigest !== reviewDigest || saved.proposal?.safeAddress !== safeAddress ||
        !/^\d+$/.test(saved.approvalDeadline) || !/^0x[0-9a-f]{64}$/i.test(saved.proposal.safeTxHash)) {
      throw new Error("Invalid persisted Safe review proposal");
    }
    if (BigInt(saved.approvalDeadline) > BigInt(latestBlock.timestamp)) {
      try {
        await apiKit.getTransaction(saved.proposal.safeTxHash);
      } catch (error: any) {
        if (error.statusCode !== 404 && error.status !== 404 && error.response?.status !== 404) throw error;
        await apiKit.proposeTransaction(saved.proposal);
      }
      return { reviewDigest, approvalDeadline: saved.approvalDeadline, proposalHash: saved.proposal.safeTxHash };
    }
  }
  let nonce = Number(
    await retry(() => apiKit.getNextNonce(safeAddress), {
      logPrefix: "ExternalWithdrawalService",
    }),
  );
  // Journals reserve nonces even when the Safe service has not indexed a proposal yet.
  const journalDirectory = path.dirname(journalPath);
  await fs.mkdir(journalDirectory, { recursive: true });
  const prefix = `${chainId}-${safeAddress.toLowerCase()}-`;
  for (const name of await fs.readdir(journalDirectory)) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const entry = JSON.parse(await fs.readFile(path.join(journalDirectory, name), "utf8")) as PersistedWithdrawalReview;
    const reservedNonce = Number(entry.proposal?.safeTransactionData?.nonce);
    if (entry.proposal?.safeAddress !== safeAddress || !Number.isSafeInteger(reservedNonce) || reservedNonce < 0) {
      throw new Error("Invalid persisted Safe review nonce; restore the journal before proposing");
    }
    nonce = Math.max(nonce, reservedNonce + 1);
  }
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error("Invalid Safe nonce");
  const safeTransaction = await protocolKit.createTransaction({
    transactions: [{
      to: review.destinationVault,
      value: "0",
      data: vaultInterface.encodeFunctionData("approveLargeWithdrawal", [
        reviewDigest,
        approvalDeadline,
      ]),
      operation: OperationType.Call,
    }],
    options: { nonce },
  });
  const proposalHash = await protocolKit.getTransactionHash(safeTransaction);
  const signature = await protocolKit.signHash(proposalHash);
  const proposal = {
    safeAddress,
    safeTransactionData: safeTransaction.data,
    safeTxHash: proposalHash,
    senderAddress: relayer,
    senderSignature: signature.data,
  };
  const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
  const file = await fs.open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ reviewDigest, approvalDeadline: approvalDeadline.toString(), proposal }));
    await file.sync();
  } finally { await file.close(); }
  await fs.rename(temporaryPath, journalPath);
  const directory = await fs.open(path.dirname(journalPath), "r");
  try { await directory.sync(); } finally { await directory.close(); }
  await retry(() => apiKit.proposeTransaction(proposal), { logPrefix: "ExternalWithdrawalService" });

  return {
    reviewDigest,
    approvalDeadline: approvalDeadline.toString(),
    proposalHash,
  };
};

const safeReviewQueues = new Map<string, Promise<unknown>>();

export const proposeWithdrawalReview = (review: WithdrawalReview) => {
  const key = `${config.safe.address}:${getWithdrawalReviewDigest(review)}`;
  const existing = pendingReviewProposals.get(key);
  if (existing) return existing;
  const safeKey = `${review.destinationChainId}:${(config.safe.address || "").toLowerCase()}`;
  const previous = safeReviewQueues.get(safeKey) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(() => createWithdrawalReviewProposal(review)).finally(() => {
    pendingReviewProposals.delete(key);
    if (safeReviewQueues.get(safeKey) === pending) safeReviewQueues.delete(safeKey);
  });
  safeReviewQueues.set(safeKey, pending);
  pendingReviewProposals.set(key, pending);
  return pending;
};

export const signWithdrawalAuthorization = async (
  authorization: WithdrawalAuthorization,
): Promise<string[]> => {
  const signerUrls = getExternalBridgeVerifierUrls(
    BigInt(authorization.destinationChainId),
  );
  const signerApiTokens = getExternalBridgeVerifierApiTokens(
    BigInt(authorization.destinationChainId),
  );
  if (signerUrls.length === 0) {
    throw new Error(
      `CHAIN_${authorization.destinationChainId}_EXTERNAL_BRIDGE_VERIFIER_URLS is not configured`,
    );
  }
  if (signerApiTokens.length !== signerUrls.length) {
    throw new Error(
      `External bridge signer API token count does not match signer URL count for chain ${authorization.destinationChainId}`,
    );
  }

  const results = await Promise.allSettled(
    signerUrls.map(async (url, index) => {
      const response = await axios.post(
        `${url}/v1/sign-withdrawal`,
        authorization,
        {
          timeout: VERIFIER_REQUEST_TIMEOUT_MS,
          signal: AbortSignal.timeout(VERIFIER_REQUEST_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${signerApiTokens[index]}`,
          },
        },
      );
      const signature = Signature.from(response.data.signature).serialized;
      const recovered = verifyTypedData(
        authorizationDomain(authorization),
        WITHDRAWAL_AUTHORIZATION_TYPES,
        authorization,
        signature,
      ).toLowerCase();
      if (
        typeof response.data.authorizationSigner !== "string" ||
        recovered !== response.data.authorizationSigner.toLowerCase()
      ) {
        throw new Error(`Signer ${url} returned an invalid signature`);
      }
      return {
        signer: recovered,
        signature,
      };
    }),
  );

  const signatures = new Map<string, string>();
  const manualReviewRequired = results.filter(
    (result) =>
      result.status === "rejected" &&
      axios.isAxiosError(result.reason) &&
      result.reason.response?.status === 409 &&
      result.reason.response?.data?.decision === "manual_review",
  ).length;
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logError("ExternalWithdrawal", result.reason as Error, {
        operation: "signWithdrawalAuthorization",
        verifierUrl: signerUrls[index],
        withdrawalId: authorization.sourceWithdrawalId,
      });
    }
  });
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const response = result.value;
    if (signatures.has(response.signer)) {
      logError(
        "ExternalWithdrawal",
        new Error(`Duplicate external bridge signer ${response.signer}`),
        {
          operation: "signWithdrawalAuthorization",
          withdrawalId: authorization.sourceWithdrawalId,
        },
      );
      continue;
    }
    signatures.set(response.signer, response.signature);
  }
  const sorted = [...signatures.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, signature]) => signature);
  if (manualReviewRequired > 0) {
    await proposeWithdrawalReview(authorization);
    throw new Error(
      `Local verifier manual review requires executed Safe approval for withdrawal ${authorization.sourceWithdrawalId}`,
    );
  }
  return sorted;
};

export const getWithdrawalCapacity = async (withdrawal: WithdrawalInfo) => {
  if (!withdrawal.vault) throw new Error(`Withdrawal ${withdrawal.withdrawalId} is missing its vault`);
  const provider = getChainProvider(BigInt(withdrawal.externalChainId));
  const vault = new Contract(safeChecksum(withdrawal.vault), EXTERNAL_VAULT_ABI, provider);
  const capacity = await vault.withdrawalCapacity(
    safeChecksum(withdrawal.externalToken), withdrawal.externalTokenAmount,
  );
  return { available: BigInt(capacity.available), retryAfterSeconds: BigInt(capacity.retryAfterSeconds) };
};

export const buildWithdrawalAuthorization = async (
  withdrawal: WithdrawalInfo,
  sourceChainId: bigint,
  sourceBridgeAddress: string,
): Promise<WithdrawalAuthorization> => {
  if (!withdrawal.vault) {
    throw new Error(`Withdrawal ${withdrawal.withdrawalId} is missing its vault`);
  }

  const destinationChainId = BigInt(withdrawal.externalChainId);
  const provider = getChainProvider(destinationChainId);
  const vault = new Contract(
    safeChecksum(withdrawal.vault),
    EXTERNAL_VAULT_ABI,
    provider,
  );
  const [latestBlock, validity, signerSetVersion] = await Promise.all([
    provider.getBlock("latest"),
    vault.maxAuthorizationValiditySeconds(),
    vault.signerSetVersion(),
  ]);
  if (!latestBlock) {
    throw new Error(`Latest block not found for chain ${destinationChainId}`);
  }

  const validitySeconds = BigInt(validity.toString());
  const storedDeadline = BigInt(withdrawal.authorizationDeadline || 0);
  const hasStoredAuthorization = storedDeadline > 0n;
  if (
    hasStoredAuthorization &&
    (withdrawal.authorizationNotBefore == null ||
      BigInt(withdrawal.signerSetVersion || 0) <= 0n)
  ) {
    throw new Error(
      `Withdrawal ${withdrawal.withdrawalId} has incomplete authorization state`,
    );
  }
  const notBefore = hasStoredAuthorization
    ? BigInt(withdrawal.authorizationNotBefore!)
    : BigInt(latestBlock.timestamp);
  const deadline = hasStoredAuthorization
    ? storedDeadline
    : notBefore + validitySeconds;
  if (validitySeconds <= 0n) {
    throw new Error(`Vault on chain ${destinationChainId} has invalid validity`);
  }

  return {
    sourceChainId: sourceChainId.toString(),
    sourceBridge: safeChecksum(sourceBridgeAddress),
    sourceWithdrawalId: withdrawal.withdrawalId,
    destinationChainId: destinationChainId.toString(),
    destinationVault: safeChecksum(withdrawal.vault),
    token: safeChecksum(withdrawal.externalToken),
    recipient: safeChecksum(withdrawal.externalRecipient),
    amount: withdrawal.externalTokenAmount,
    notBefore: notBefore.toString(),
    deadline: deadline.toString(),
    signerSetVersion:
      withdrawal.signerSetVersion || signerSetVersion.toString(),
  };
};

export const getReservationId = (
  authorization: WithdrawalAuthorization,
): string =>
  keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256"],
      [
        authorization.sourceChainId,
        authorization.sourceBridge,
        authorization.sourceWithdrawalId,
      ],
    ),
  );

export const getEventTransactionHash = async (
  provider: JsonRpcProvider,
  vaultAddress: string,
  eventName:
    | "WithdrawalReserved"
    | "WithdrawalReleased"
    | "WithdrawalCancelled",
  reservationId: string,
  notBefore: string,
): Promise<string> => {
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest block unavailable for withdrawal recovery");
  let lower = 0;
  let upper = latest.number;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const block = await provider.getBlock(middle);
    if (!block) throw new Error(`Block ${middle} unavailable for withdrawal recovery`);
    if (BigInt(block.timestamp) < BigInt(notBefore)) lower = middle + 1;
    else upper = middle;
  }
  let toBlock = latest.number;
  let range = EXTERNAL_BRIDGE_LOG_BLOCK_RANGE;
  while (toBlock >= lower) {
    const fromBlock = Math.max(lower, toBlock - range + 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: vaultAddress,
        topics: vaultInterface.encodeFilterTopics(eventName, [reservationId]),
        fromBlock,
        toBlock,
      });
    } catch (error) {
      if (range === 1) throw error;
      range = Math.max(1, Math.floor(range / 2));
      continue;
    }
    const transactionHash = logs.at(-1)?.transactionHash;
    if (transactionHash) return transactionHash;
    toBlock = fromBlock - 1;
  }
  throw new Error(`${eventName} event not found for ${reservationId}`);
};

export const getReservationState = async (
  authorization: WithdrawalAuthorization,
  includeReservationTxHash = true,
): Promise<{
  reservationId: string;
  status: number;
  latestTimestamp: bigint;
  reservationTxHash?: string;
}> => {
  const provider = getChainProvider(BigInt(authorization.destinationChainId));
  const vault = new Contract(
    authorization.destinationVault,
    EXTERNAL_VAULT_ABI,
    provider,
  );
  const reservationId = getReservationId(authorization);
  const [reservation, latestBlock] = await Promise.all([
    vault.reservations(reservationId),
    provider.getBlock("latest"),
  ]);
  if (!latestBlock) {
    throw new Error(
      `Latest block not found for chain ${authorization.destinationChainId}`,
    );
  }
  const status = Number(reservation.status ?? reservation[0]);
  return {
    reservationId,
    status,
    latestTimestamp: BigInt(latestBlock.timestamp),
    reservationTxHash:
      status === 0 || !includeReservationTxHash
        ? undefined
        : await getEventTransactionHash(
            provider,
            authorization.destinationVault,
            "WithdrawalReserved",
            reservationId,
            authorization.notBefore,
          ),
  };
};

const getVaultWithSigner = (
  authorization: WithdrawalAuthorization,
): {
  provider: JsonRpcProvider;
  vault: Contract;
} => {
  const chainId = BigInt(authorization.destinationChainId);
  const provider = getChainProvider(chainId);
  const kmsConfig = getExternalBridgeExecutorKmsConfig(chainId);
  if (!kmsConfig) {
    throw new Error(
      `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR workload-identity KMS is not configured`,
    );
  }
  return {
    provider,
    vault: new Contract(
      authorization.destinationVault,
      EXTERNAL_VAULT_ABI,
      new DigestKmsSigner(kmsConfig, provider),
    ),
  };
};

export const reserveWithdrawal = async (
  authorization: WithdrawalAuthorization,
): Promise<{ reservationId: string; transactionHash: string }> => {
  const { provider, vault } = getVaultWithSigner(authorization);
  const reservationId = getReservationId(authorization);
  const reservation = await vault.reservations(reservationId);
  const status = Number(reservation.status ?? reservation[0]);

  if (status === 0) {
    const signatures = await signWithdrawalAuthorization(authorization);
    const threshold = Number(await vault.attestationThreshold());
    if (signatures.length < threshold) {
      throw new Error(
        `External bridge attestation threshold requires ${threshold} signatures; configured ${signatures.length}`,
      );
    }
    const transaction = await vault.reserve(authorization, signatures);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Vault reservation failed: ${transaction.hash}`);
    }
    return { reservationId, transactionHash: receipt.hash };
  }
  if (status !== 1) {
    throw new Error(`Reservation ${reservationId} is not reservable`);
  }

  return {
    reservationId,
    transactionHash: await getEventTransactionHash(
      provider,
      authorization.destinationVault,
      "WithdrawalReserved",
      reservationId,
      authorization.notBefore,
    ),
  };
};

export const releaseWithdrawal = async (
  authorization: WithdrawalAuthorization,
  reservationId: string,
): Promise<string> => {
  const { provider, vault } = getVaultWithSigner(authorization);
  const reservation = await vault.reservations(reservationId);
  const status = Number(reservation.status ?? reservation[0]);

  if (status === 1) {
    const transaction = await vault.release(reservationId);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Vault release failed: ${transaction.hash}`);
    }
    return receipt.hash;
  }
  if (status !== 2) {
    throw new Error(`Reservation ${reservationId} is not releasable`);
  }

  return getEventTransactionHash(
    provider,
    authorization.destinationVault,
    "WithdrawalReleased",
    reservationId,
    authorization.notBefore,
  );
};

export const cancelExpiredWithdrawal = async (
  authorization: WithdrawalAuthorization,
  reservationId: string,
): Promise<string> => {
  const { provider, vault } = getVaultWithSigner(authorization);
  const reservation = await vault.reservations(reservationId);
  const status = Number(reservation.status ?? reservation[0]);

  if (status === 1) {
    const transaction = await vault.cancelExpired(reservationId);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Vault cancellation failed: ${transaction.hash}`);
    }
    return receipt.hash;
  }
  if (status !== 3) {
    throw new Error(`Reservation ${reservationId} is not cancellable`);
  }

  return getEventTransactionHash(
    provider,
    authorization.destinationVault,
    "WithdrawalCancelled",
    reservationId,
    authorization.notBefore,
  );
};

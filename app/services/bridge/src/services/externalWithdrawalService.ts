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
  getExternalBridgeExecutorKmsConfig,
  getExternalBridgeVerifierApiTokens,
  getExternalBridgeVerifierUrls,
  getChainRpcUrl,
} from "../config";
import { WithdrawalInfo } from "../types";
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
const localReviewProposals = new Set<string>();

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
  const provider = new JsonRpcProvider(getChainRpcUrl(BigInt(chainId)));
  const latestBlock = await provider.getBlock("latest");
  if (!latestBlock) {
    throw new Error(`Latest block not found for chain ${chainId}`);
  }
  return BigInt(latestBlock.timestamp);
};

export const proposeWithdrawalReview = async (
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
  const provider = new JsonRpcProvider(getChainRpcUrl(chainId));
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
  const nonce = Number(
    await retry(() => apiKit.getNextNonce(safeAddress), {
      logPrefix: "ExternalWithdrawalService",
    }),
  );
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
  await retry(
    () =>
      apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash: proposalHash,
        senderAddress: relayer,
        senderSignature: signature.data,
      }),
    { logPrefix: "ExternalWithdrawalService" },
  );

  return {
    reviewDigest,
    approvalDeadline: approvalDeadline.toString(),
    proposalHash,
  };
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
    const provider = new JsonRpcProvider(
      getChainRpcUrl(BigInt(authorization.destinationChainId)),
    );
    const vault = new Contract(
      authorization.destinationVault,
      EXTERNAL_VAULT_ABI,
      provider,
    );
    const threshold = Number(await vault.attestationThreshold());
    if (sorted.length >= threshold) return sorted;
    const digest = getWithdrawalReviewDigest(authorization);
    if (!localReviewProposals.has(digest)) {
      await proposeWithdrawalReview(authorization);
      localReviewProposals.add(digest);
    }
    throw new Error(
      `Local verifier manual review requires executed Safe approval for withdrawal ${authorization.sourceWithdrawalId}`,
    );
  }
  return sorted;
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
  const provider = new JsonRpcProvider(getChainRpcUrl(destinationChainId));
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

const getEventTransactionHash = async (
  provider: JsonRpcProvider,
  vaultAddress: string,
  eventName:
    | "WithdrawalReserved"
    | "WithdrawalReleased"
    | "WithdrawalCancelled",
  reservationId: string,
): Promise<string> => {
  const logs = await provider.getLogs({
    address: vaultAddress,
    topics: vaultInterface.encodeFilterTopics(eventName, [reservationId]),
    fromBlock: 0,
    toBlock: "latest",
  });
  const transactionHash = logs.at(-1)?.transactionHash;
  if (!transactionHash) {
    throw new Error(`${eventName} event not found for ${reservationId}`);
  }
  return transactionHash;
};

export const getReservationState = async (
  authorization: WithdrawalAuthorization,
): Promise<{
  reservationId: string;
  status: number;
  latestTimestamp: bigint;
  reservationTxHash?: string;
}> => {
  const provider = new JsonRpcProvider(
    getChainRpcUrl(BigInt(authorization.destinationChainId)),
  );
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
      status === 0
        ? undefined
        : await getEventTransactionHash(
            provider,
            authorization.destinationVault,
            "WithdrawalReserved",
            reservationId,
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
  const provider = new JsonRpcProvider(getChainRpcUrl(chainId));
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
  );
};

import { readOAuthDiscovery } from "../auth/discovery";
import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { verifierFailureDetails } from "../utils/processingIssues";
import { normalizeHex as normalize } from "../utils/utils";
import express from "express";
import { WithdrawalReleasePendingError } from "../types";
import type { DepositRefundAuthorization } from "../types";
import {
  DEPOSIT_REFUND_TYPES,
  NATIVE_ATTESTATION_ABI,
  NATIVE_MINT_V2_TYPES,
  NATIVE_REFUND_TYPES,
  NATIVE_BRIDGE_DIGEST_ABI,
} from "../config/bridgeAbi";
import { validateDepositRefundSource, validateDepositRefundEvidence, validateDepositRefundCompletion } from "./depositRefundValidation";
import { ConsensusProvider } from "./consensusProvider";
import { buildBridgeDigestRequest, depositDigestArgs, parseBridgeDigest } from "./authorizationValidation";
import { verifierAccessControl } from "./accessControl";
import {
  Contract,
  TypedDataEncoder,
  getAddress,
} from "ethers";
import { matchesSourceWithdrawalAuthorization } from "./authorizationValidation";
import {
  DepositSettlementAttestation,
  validateDepositSettlement,
  validateWithdrawalRelease,
} from "./settlementValidation";
import { DigestKmsSigner, validateAwsKmsAddress } from "../utils/kmsSigner";
import {
  evaluateDepositPolicy,
  evaluateWithdrawalPolicy,
  loadVerifierPolicy,
} from "./verifierPolicy";
import { loadNativeVerifierPolicy } from "./nativeVerifierPolicy";
import {
  verifyNativeMint,
  verifyNativeMintCancellation,
  verifyNativeRedemptionsBatch,
  verifyNativeRedemptionRefund,
} from "./nativeSettlementValidation";
import type { NativeDepositInfo, NativeWithdrawalInfo, NativeVerificationRpc } from "../types";
import {
  NativeMintAttestation,
  NativeRedemptionRefund,
  validateNativeMintAttestation,
  validateNativeRedemptionRefund,
  parseNativeSourceRecord,
} from "./nativeAttestationValidation";

interface WithdrawalAuthorization {
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

const AUTHORIZATION_TYPES = {
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

const VAULT_ABI = [
  "function getReservationId(uint256 sourceChainId,address sourceBridge,uint256 sourceWithdrawalId) pure returns (bytes32)",
  "function reservations(bytes32) view returns (uint8 status,address token,address recipient,uint256 amount,uint256 deadline,bytes32 authorizationDigest)",
  "function attestationSigners(address) view returns (bool)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
  "function signerSetVersion() view returns (uint256)",
  "function tokenPolicies(address) view returns (bool enabled,uint256 maxPerWithdrawal,uint256 bucketCapacity,uint256 refillRate,uint256 lastRefillAt,uint256 consumedCapacity,uint256 manualReviewThreshold)",
  "function largeWithdrawalApprovalDeadline(bytes32) view returns (uint256)",
];

const WITHDRAWAL_REVIEW_TYPES = {
  WithdrawalReview: [
    { name: "sourceChainId", type: "uint256" },
    { name: "sourceBridge", type: "address" },
    { name: "sourceWithdrawalId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "destinationVault", type: "address" },
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
  ],
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const destinationChainId = BigInt(required("DESTINATION_CHAIN_ID"));
const destinationVault = getAddress(required("DESTINATION_VAULT_ADDRESS"));
const authorizationSignerAddress = getAddress(
  required("VAULT_AUTHORIZATION_SIGNER_ADDRESS"),
);
const verifierRpcUrls = [required("VERIFIER_RPC_URL"), ...required("VERIFIER_INDEPENDENT_RPC_URLS").split(",").map((url) => url.trim())];
const provider = new ConsensusProvider(verifierRpcUrls);
const vault = new Contract(destinationVault, VAULT_ABI, provider);
const kmsConfig = {
  address: authorizationSignerAddress,
  keyId: required("KMS_KEY_ID"),
  region: required("KMS_REGION"),
};
const kmsSigner = new DigestKmsSigner(kmsConfig, provider);
const stratoNodeUrl = required("STRATO_NODE_URL").replace(/\/$/, "");
const nativeStratoNodeUrl = (process.env.NATIVE_STRATO_NODE_URL?.trim() || stratoNodeUrl).replace(/\/$/, "");
const sourceChainId = BigInt(required("SOURCE_CHAIN_ID"));
// Cirrus stores contract addresses as bare lowercase hex and its eq. filters are case-sensitive,
// so accept 0x-prefixed and checksummed input but always query with the lowercase form.
const sourceBridge = required("EXTERNAL_ASSET_BRIDGE_ADDRESS").replace(/^0x/, "").toLowerCase();
const verifierApiToken = required("EXTERNAL_BRIDGE_VERIFIER_API_TOKEN");
const { policy: verifierPolicy, digest: verifierPolicyDigest } =
  loadVerifierPolicy(required("VERIFIER_POLICY_PATH"));
const signerOpenIdDiscoveryUrl = required(
  "SETTLEMENT_ATTESTOR_OPENID_DISCOVERY_URL",
);
const signerClientId = required("SETTLEMENT_ATTESTOR_CLIENT_ID");
const signerClientSecret = required("SETTLEMENT_ATTESTOR_CLIENT_SECRET");
const signerBaUsername = required("SETTLEMENT_ATTESTOR_BA_USERNAME");
const signerBaPassword = required("SETTLEMENT_ATTESTOR_BA_PASSWORD");
const verifierConfirmations = Number(
  required("VERIFIER_CONFIRMATIONS"),
);
const port = Number(process.env.PORT || 3004);

const assertNativeEvidenceChain = (chainId: number): void => {
  if (!Number.isSafeInteger(chainId) || BigInt(chainId) !== destinationChainId) {
    throw new Error("Native evidence chain does not match verifier configuration");
  }
};
const nativeEvidenceRpc: NativeVerificationRpc = {
  getDepositConfirmationPolicy: (chainId) => {
    assertNativeEvidenceChain(chainId);
    if (!Number.isSafeInteger(verifierConfirmations) || verifierConfirmations < 1) {
      throw new Error("Invalid verifier confirmation policy");
    }
    return verifierConfirmations;
  },
  getVerificationBlockNumber: async (chainId) => {
    assertNativeEvidenceChain(chainId);
    return Number(BigInt(await provider.send("eth_blockNumber", [])));
  },
  getTransactionReceiptsBatch: async (chainId, hashes) => {
    assertNativeEvidenceChain(chainId);
    return new Map(await Promise.all(hashes.map(async (hash) => {
      const receipt = await provider.send("eth_getTransactionReceipt", [hash]);
      if (receipt) {
        const block = await provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
        if (!block?.hash || block.hash.toLowerCase() !== receipt.blockHash?.toLowerCase()) {
          throw new Error("Native receipt is not canonical");
        }
      }
      return [hash, receipt] as const;
    })));
  },
};

const nativePolicyPath = process.env.NATIVE_VERIFIER_POLICY_PATH?.trim();
const nativeVerifier = nativePolicyPath
  ? (() => {
      const { policy, digest } = loadNativeVerifierPolicy(nativePolicyPath);
      const signerAddress = getAddress(required("NATIVE_ATTESTATION_SIGNER_ADDRESS"));
      const sourceBridgeAddress = required("STRATO_NATIVE_BRIDGE_ADDRESS")
        .replace(/^0x/, "")
        .toLowerCase();
      const destinationBridge = getAddress(
        required("NATIVE_REPRESENTATION_BRIDGE_ADDRESS"),
      );
      if (
        policy.sourceChainId !== sourceChainId.toString() ||
        policy.sourceBridge !== sourceBridgeAddress ||
        policy.destinationChainId !== destinationChainId.toString() ||
        policy.destinationBridge !== destinationBridge
      ) {
        throw new Error("Native verifier policy bridge or chain binding does not match");
      }
      const kms = {
        address: signerAddress,
        keyId: required("NATIVE_KMS_KEY_ID"),
        region: required("NATIVE_KMS_REGION"),
      };
      // Temporarily allow native and EAB verification to share a KMS key.
      // if (
      //   signerAddress === authorizationSignerAddress ||
      //   kms.keyId === kmsConfig.keyId
      // ) {
      //   throw new Error("Native verification requires a separate KMS key and signer");
      // }
      return {
        policy,
        digest,
        signerAddress,
        sourceBridge: sourceBridgeAddress,
        destinationBridge,
        kms,
        signer: new DigestKmsSigner(kms, provider),
        bridge: new Contract(destinationBridge, NATIVE_ATTESTATION_ABI, provider),
      };
    })()
  : undefined;
if (
  !Number.isSafeInteger(verifierConfirmations) ||
  verifierConfirmations <= 0
) {
  throw new Error(
    "VERIFIER_CONFIRMATIONS must be a positive integer",
  );
}
if (
  BigInt(verifierPolicy.sourceChainId) !== sourceChainId ||
  verifierPolicy.sourceBridge.replace(/^0x/, "").toLowerCase() !==
    sourceBridge.replace(/^0x/, "").toLowerCase() ||
  BigInt(verifierPolicy.destinationChainId) !== destinationChainId ||
  getAddress(verifierPolicy.destinationVault) !== destinationVault
) {
  throw new Error("Verifier policy bridge or chain binding does not match");
}

const domain = (authorization: WithdrawalAuthorization) => ({
  name: "ExternalBridgeVault",
  version: "1",
  chainId: destinationChainId,
  verifyingContract: destinationVault,
});

const authHeaders = (token?: string) =>
  token ? { Authorization: `Bearer ${token}` } : undefined;

let stratoToken: { value: string; expiresAt: number } | undefined;
let stratoTokenPromise: Promise<string> | undefined;
let tokenEndpoint: string | undefined;
let settlementAttestorAddress: string | undefined;

const getStratoToken = async (): Promise<string> => {
  if (stratoToken && stratoToken.expiresAt > Date.now() + 30_000) {
    return stratoToken.value;
  }
  if (stratoTokenPromise) return stratoTokenPromise;
  stratoTokenPromise = (async () => {
    if (!tokenEndpoint) {
      const discovery = await readOAuthDiscovery(signerOpenIdDiscoveryUrl);
      tokenEndpoint = discovery.token_endpoint;
      if (!tokenEndpoint) throw new Error("OpenID token endpoint is unavailable");
    }
    const body = new URLSearchParams({
      grant_type: "password",
      username: signerBaUsername,
      password: signerBaPassword,
      scope: "openid email profile",
    });
    const response = await axios.post(tokenEndpoint, body.toString(), {
      maxRedirects: 0,
      auth: {
        username: signerClientId,
        password: signerClientSecret,
      },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const value = response.data?.access_token;
    if (!value) throw new Error("OAuth response did not include an access token");
    stratoToken = {
      value,
      expiresAt: Date.now() + Number(response.data.expires_in || 60) * 1000,
    };
    return value;
  })();
  try {
    return await stratoTokenPromise;
  } finally {
    stratoTokenPromise = undefined;
  }
};

const stratoGet = async (path: string, params: Record<string, string>, nodeUrl = stratoNodeUrl) => {
  const request = async () =>
    axios.get(`${nodeUrl}${path}`, {
      headers: authHeaders(await getStratoToken()),
      params,
    });
  try {
    return await request();
  } catch (error: any) {
    if (error?.response?.status !== 401) throw error;
    stratoToken = undefined;
    return request();
  }
};

const nativeStratoGet = (path: string, params: Record<string, string>) =>
  stratoGet(path, params, nativeStratoNodeUrl);

const readSourceDigest = async (
  method: string,
  args: unknown[],
  contractAddress = sourceBridge,
  nodeUrl = stratoNodeUrl,
  digestAbi?: readonly string[],
): Promise<string> => {
  const request = async () => axios.post(`${nodeUrl}/rpc`,
    buildBridgeDigestRequest(contractAddress, method, args, digestAbi),
    { headers: authHeaders(await getStratoToken()), timeout: 30_000 });
  try { return parseBridgeDigest((await request()).data); }
  catch (error: any) {
    if (error?.response?.status !== 401) throw error;
    stratoToken = undefined;
    return parseBridgeDigest((await request()).data);
  }
};

const submitStratoAttestation = async (
  method: string,
  args: Record<string, unknown>,
  contractName = "ExternalAssetBridge",
  contractAddress = sourceBridge,
  nodeUrl = stratoNodeUrl,
): Promise<string> => {
  const request = async () =>
    axios.post(
      `${nodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
      {
        txs: [
          {
            type: "FUNCTION",
            payload: {
              contractName,
              contractAddress,
              method,
              args,
            },
          },
        ],
        txParams: { gasLimit: 32_100_000_000, gasPrice: 1 },
      },
      { headers: authHeaders(await getStratoToken()) },
    );
  let response;
  try {
    response = await request();
  } catch (error: any) {
    if (error?.response?.status !== 401) throw error;
    stratoToken = undefined;
    response = await request();
  }
  let result = response.data?.[0];
  if (!result?.hash) {
    throw new Error(
      `STRATO settlement attestation failed: ${result?.status || "unknown"}`,
    );
  }
  for (let attempt = 0; attempt < 12 && result?.status === "Pending"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    try {
      const polled = await axios.post(
        `${nodeUrl}/bloc/v2.2/transactions/results`,
        [result.hash],
        { headers: authHeaders(await getStratoToken()) },
      );
      result = polled.data?.[0];
    } catch (error: any) {
      if (error?.response?.status !== 401) throw error;
      stratoToken = undefined;
    }
  }
  if (result?.status !== "Success") {
    throw new Error(
      `STRATO settlement attestation failed: ${result?.status || "unknown"}`,
    );
  }
  return result.hash;
};

const getDepositChainConfig = async (
  chainId: string,
): Promise<{ vault: string; routers: string[] }> => {
  const [chainResponse, routerResponse] = await Promise.all([
    stratoGet(
      "/cirrus/search/BlockApps-ExternalAssetBridge-chains",
      {
        address: `eq.${sourceBridge}`,
        key: `eq.${chainId}`,
        select: "value",
      },
    ),
    stratoGet(
      "/cirrus/search/BlockApps-ExternalAssetBridge-depositRouters",
      {
        address: `eq.${sourceBridge}`,
        key: `eq.${chainId}`,
        value: "eq.true",
        select: "key2",
      },
    ),
  ]);
  const chain = chainResponse.data?.[0]?.value;
  if (!chain?.enabled || !chain.vault) {
    throw new Error("Deposit chain is not enabled by the source bridge");
  }
  const routers = (routerResponse.data || []).map((row: any) => row.key2);
  return { vault: chain.vault, routers };
};

const validateSettlementVerifier = async (): Promise<string> => {
  const keyResponse = await stratoGet("/strato/v2.3/key", {});
  const address = normalize(keyResponse.data?.address || "");
  if (!address) throw new Error("STRATO verifier address is unavailable");
  const verifierResponse = await stratoGet(
    "/cirrus/search/BlockApps-ExternalAssetBridge-settlementVerifiers",
    {
      address: `eq.${sourceBridge}`,
      key: `eq.${address}`,
      value: "eq.true",
      select: "key",
    },
  );
  if (!verifierResponse.data?.length) {
    throw new Error(`STRATO account ${address} is not a settlement verifier`);
  }
  if (nativeVerifier) {
    const nativeIdentity = await nativeStratoGet("/strato/v2.3/key", {});
    const nativeMetadata = await nativeStratoGet("/strato-api/eth/v1.2/metadata", {});
    if (normalize(nativeIdentity.data?.address || "") !== address ||
        String(nativeMetadata.data?.networkID) !== nativeVerifier.policy.sourceChainId) {
      throw new Error("Native STRATO node identity or network mismatch");
    }
    const [nativeVerifierResponse, nativeBridgeResponse] = await Promise.all([
      nativeStratoGet(
        "/cirrus/search/BlockApps-StratoNativeBridge-settlementVerifiers",
        {
          address: `eq.${nativeVerifier.sourceBridge}`,
          key: `eq.${address}`,
          value: "eq.true",
          select: "key",
        },
      ),
      nativeStratoGet("/cirrus/search/BlockApps-StratoNativeBridge", {
        address: `eq.${nativeVerifier.sourceBridge}`,
        select: "settlementVerifierThreshold,settlementVerifierCount",
        limit: "1",
      }),
    ]);
    if (!nativeVerifierResponse.data?.length) {
      throw new Error(
        `STRATO account ${address} is not a native settlement verifier`,
      );
    }
    const nativeBridge = nativeBridgeResponse.data?.[0];
    if (
      Number(nativeBridge?.settlementVerifierThreshold || 0) < 2 ||
      Number(nativeBridge?.settlementVerifierThreshold || 0) >
        Number(nativeBridge?.settlementVerifierCount || 0)
    ) {
      throw new Error("Native settlement verifier quorum is not configured");
    }
  }
  return address;
};

const validateSourceWithdrawal = async (
  authorization: WithdrawalAuthorization,
  allowedStatuses = [3],
  requireEnabledChain = true,
  // Pre-flight checks run before markWithdrawalReady commits the
  // authorization on STRATO, so there is no stored record to match yet.
  requireCommittedAuthorization = true,
) => {
  if (normalize(authorization.sourceBridge) !== normalize(sourceBridge)) {
    throw new Error("Source bridge mismatch");
  }
  if (BigInt(authorization.sourceChainId) !== sourceChainId) {
    throw new Error("Source chain mismatch");
  }
  const response = await stratoGet(
    "/cirrus/search/BlockApps-ExternalAssetBridge-withdrawals",
    {
      address: `eq.${sourceBridge}`,
      key: `eq.${authorization.sourceWithdrawalId}`,
      select: "value",
    },
  );
  const withdrawal = response.data?.[0]?.value;
  if (!withdrawal || !allowedStatuses.includes(Number(withdrawal.status))) {
    throw new Error("Source withdrawal is not ready");
  }
  if (
    String(withdrawal.externalChainId) !== authorization.destinationChainId ||
    normalize(withdrawal.externalToken) !== normalize(authorization.token) ||
    normalize(withdrawal.externalRecipient) !== normalize(authorization.recipient) ||
    BigInt(withdrawal.externalTokenAmount) !== BigInt(authorization.amount)
  ) {
    throw new Error("Source withdrawal does not match authorization");
  }

  if (requireCommittedAuthorization) {
    const authorizationResponse = await stratoGet(
      "/cirrus/search/BlockApps-ExternalAssetBridge-withdrawalAuthorizations",
      {
        address: `eq.${sourceBridge}`,
        key: `eq.${authorization.sourceWithdrawalId}`,
        select: "value",
      },
    );
    const sourceAuthorization = authorizationResponse.data?.[0]?.value;
    if (!matchesSourceWithdrawalAuthorization(sourceAuthorization, authorization) ||
        normalize(sourceAuthorization?.destinationVault || "") !== normalize(authorization.destinationVault)) {
      throw new Error("Source withdrawal authorization does not match request");
    }
  }

  const chainResponse = await stratoGet(
    "/cirrus/search/BlockApps-ExternalAssetBridge-chains",
    {
      address: `eq.${sourceBridge}`,
      key: `eq.${authorization.destinationChainId}`,
      select: "value",
    },
  );
  const chain = chainResponse.data?.[0]?.value;
  if (
    requireEnabledChain && (!chain?.enabled ||
    normalize(chain.vault) !== normalize(authorization.destinationVault))
  ) {
    throw new Error("Destination vault is not enabled by the source bridge");
  }
  return withdrawal;
};

const validateSourceDepositRoute = async (
  deposit: DepositSettlementAttestation,
  allowFallback = false,
): Promise<boolean> => {
  const filters = {
      address: `eq.${sourceBridge}`,
      key: `eq.${normalize(deposit.externalToken)}`,
      key2: `eq.${deposit.externalChainId}`,
      key3: `eq.${normalize(deposit.stratoToken)}`,
      select: "value",
  };
  const [routeResponse, actionResponse] = await Promise.all([
    stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge-routes", {
      ...filters,
      "value->>depositsEnabled": "eq.true",
    }),
    Number(deposit.action) === 4
      ? stratoGet(
          "/cirrus/search/BlockApps-ExternalAssetBridge-depositActionConfigs",
          filters,
        )
      : Promise.resolve(undefined),
  ]);
  if (routeResponse.data?.[0]?.value?.depositsEnabled !== true) {
    throw new Error("Deposit route is not enabled by the source bridge");
  }
  if (
    Number(deposit.action) === 4 &&
    !actionResponse?.data?.[0]?.value?.autoRoute
  ) {
    if (!allowFallback) throw new Error("AUTO_ROUTE is not enabled by the source bridge");
    return true;
  }
  return false;
};

const isDepositReviewApproved = async (
  deposit: DepositSettlementAttestation,
): Promise<boolean> => {
  const response = await stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge-depositReviewApprovals", {
    address: `eq.${sourceBridge}`, key: `eq.${deposit.externalChainId}`,
    key2: `eq.${normalize(deposit.depositRouter)}`, key3: `eq.${deposit.depositId}`, select: "value",
  });
  const approval = response.data?.[0]?.value;
  if (typeof approval !== "string" || !/^(0x)?[0-9a-f]{64}$/i.test(approval) || /^(0x)?0+$/i.test(approval)) return false;
  const digest = await readSourceDigest("getDepositSettlementDigest", depositDigestArgs(deposit));
  return normalize(approval) === normalize(digest);
};

const validateDestinationIdentity = (
  authorization: WithdrawalAuthorization,
): void => {
  if (
    BigInt(authorization.destinationChainId) !== destinationChainId ||
    getAddress(authorization.destinationVault) !== destinationVault
  ) {
    throw new Error("Destination mismatch");
  }
};

const validateDestination = async (
  authorization: WithdrawalAuthorization,
): Promise<void> => {
  validateDestinationIdentity(authorization);
  const [latestBlock, validity, signerSetVersion, enabled] = await Promise.all([
    provider.getBlock("latest"),
    vault.maxAuthorizationValiditySeconds(),
    vault.signerSetVersion(),
    vault.attestationSigners(authorizationSignerAddress),
  ]);
  if (!latestBlock) throw new Error("Destination latest block unavailable");
  if (!enabled) throw new Error("KMS signer is not enabled on the vault");

  const notBefore = BigInt(authorization.notBefore);
  const deadline = BigInt(authorization.deadline);
  const latestTimestamp = BigInt(latestBlock.timestamp);
  if (
    notBefore > latestTimestamp ||
    deadline <= latestTimestamp ||
    deadline - notBefore > BigInt(validity.toString()) ||
    BigInt(authorization.signerSetVersion) !== BigInt(signerSetVersion.toString())
  ) {
    throw new Error("Authorization timing or signer set is invalid");
  }
};

const validateReleasedDestination = async (
  authorization: WithdrawalAuthorization,
  reservationId: string,
): Promise<void> => {
  validateDestinationIdentity(authorization);
  const [expectedId, reservation] = await Promise.all([
    vault.getReservationId(
      authorization.sourceChainId,
      authorization.sourceBridge,
      authorization.sourceWithdrawalId,
    ),
    vault.reservations(reservationId),
  ]);
  if (
    normalize(reservationId) !== normalize(expectedId) ||
    Number(reservation.status) !== 2 ||
    normalize(reservation.authorizationDigest) !== normalize(
      TypedDataEncoder.hash(domain(authorization), AUTHORIZATION_TYPES, authorization),
    )
  ) {
    throw new Error("Released reservation does not match authorization");
  }
};

const signWithKms = async (
  authorization: WithdrawalAuthorization,
): Promise<string> => {
  return kmsSigner.signTypedData(
    domain(authorization),
    AUTHORIZATION_TYPES,
    authorization,
  );
};

class ManualReviewRequiredError extends Error {}

const reviewDigest = (authorization: WithdrawalAuthorization): string =>
  TypedDataEncoder.hash(
    domain(authorization),
    WITHDRAWAL_REVIEW_TYPES,
    authorization,
  );

const enforceWithdrawalPolicy = async (
  authorization: WithdrawalAuthorization,
): Promise<string> => {
  const local = evaluateWithdrawalPolicy(verifierPolicy, authorization);
  const contractPolicy = await vault.tokenPolicies(authorization.token);
  const enabled = Boolean(contractPolicy.enabled ?? contractPolicy[0]);
  const maxPerWithdrawal = BigInt(
    (contractPolicy.maxPerWithdrawal ?? contractPolicy[1]).toString(),
  );
  const manualReviewThreshold = BigInt(
    (contractPolicy.manualReviewThreshold ?? contractPolicy[6]).toString(),
  );
  const amount = BigInt(authorization.amount);
  if (!enabled) throw new Error("Destination vault token is disabled");
  if (maxPerWithdrawal !== 0n && amount > maxPerWithdrawal) {
    throw new Error("Withdrawal exceeds destination vault maximum");
  }
  const requiresManualReview =
    local.decision === "manual_review" ||
    (manualReviewThreshold !== 0n && amount > manualReviewThreshold);
  if (!requiresManualReview) return local.reason;
  const approvalDeadline = BigInt(
    (await vault.largeWithdrawalApprovalDeadline(
      reviewDigest(authorization),
    )).toString(),
  );
  if (approvalDeadline < BigInt(authorization.deadline)) {
    throw Object.assign(new ManualReviewRequiredError(local.reason), { issues: [{ code: "MANUAL_REVIEW", details: {
      token: authorization.token, required: authorization.amount, limit: local.decision === "manual_review"
        ? verifierPolicy.tokens.find(token => token.token.toLowerCase() === authorization.token.toLowerCase())?.maxAutoWithdrawalAmount
        : manualReviewThreshold.toString(), units: "external-token-base-units",
    } }] });
  }
  return "executed Safe approval satisfies manual review";
};

const validatePolicyAgainstContracts = async (): Promise<void> => {
  const [source, destinationValidity] = await Promise.all([
    stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge", {
      address: `eq.${sourceBridge}`, select: "MAX_AUTHORIZATION_VALIDITY_SECONDS",
    }),
    vault.maxAuthorizationValiditySeconds(),
  ]);
  const sourceValidity = source.data?.[0]?.MAX_AUTHORIZATION_VALIDITY_SECONDS;
  if (sourceValidity == null || BigInt(sourceValidity) !== BigInt(destinationValidity)) {
    throw new Error("Source and vault authorization validity must match");
  }
  await Promise.all([
    ...verifierPolicy.routes
      .filter(({ depositsEnabled }) => depositsEnabled)
      .map((route) =>
        validateSourceDepositRoute({
          externalChainId: destinationChainId.toString(),
          externalToken: route.externalToken,
          stratoToken: route.stratoToken,
          action: route.autoRouteEnabled ? "4" : "0",
        } as DepositSettlementAttestation),
      ),
    ...verifierPolicy.tokens
      .filter(({ withdrawalsEnabled }) => withdrawalsEnabled)
      .map(async (token) => {
        const contractPolicy = await vault.tokenPolicies(token.token);
        const enabled = Boolean(contractPolicy.enabled ?? contractPolicy[0]);
        const maxPerWithdrawal = BigInt(
          (contractPolicy.maxPerWithdrawal ?? contractPolicy[1]).toString(),
        );
        const manualReviewThreshold = BigInt(
          (contractPolicy.manualReviewThreshold ?? contractPolicy[6]).toString(),
        );
        const localMaximum = BigInt(token.maxAutoWithdrawalAmount);
        if (!enabled) {
          throw new Error(
            `Local policy enables a disabled vault token: ${token.token}`,
          );
        }
        if (maxPerWithdrawal !== 0n && localMaximum > maxPerWithdrawal) {
          throw new Error(
            `Local automatic withdrawal limit exceeds vault maximum: ${token.token}`,
          );
        }
        if (
          manualReviewThreshold !== 0n &&
          localMaximum > manualReviewThreshold
        ) {
          throw new Error(
            `Local automatic withdrawal limit exceeds vault review threshold: ${token.token}`,
          );
        }
      }),
  ]);
};

const auditDecision = (
  operation: string,
  requestId: string,
  decision: string,
  reason: string,
) => {
  console.log(
    JSON.stringify({
      event: "external_bridge_verifier_decision",
      operation,
      requestId,
      decision,
      reason,
      policyVersion: verifierPolicy.version,
      policyDigest: verifierPolicyDigest,
      authorizationSigner: authorizationSignerAddress,
      settlementAttestor: settlementAttestorAddress,
      timestamp: new Date().toISOString(),
    }),
  );
};

const app = express();
app.set("env", "production");

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    authorizationSigner: authorizationSignerAddress,
    settlementAttestor: settlementAttestorAddress,
    verifierConfirmations,
    verificationRpcHostCount: new Set(verifierRpcUrls.map((url) => new URL(url).hostname)).size,
    destinationChainId: destinationChainId.toString(),
    destinationVault,
    policyVersion: verifierPolicy.version,
    policyDigest: verifierPolicyDigest,
    baselinePolicyHash: verifierPolicy.baselinePolicyHash,
    verifierIndex: verifierPolicy.verifierIndex,
    native: nativeVerifier
      ? {
          attestationSigner: nativeVerifier.signerAddress,
          sourceBridge: nativeVerifier.sourceBridge,
          destinationBridge: nativeVerifier.destinationBridge,
          policyVersion: nativeVerifier.policy.version,
          policyDigest: nativeVerifier.digest,
          baselinePolicyHash: nativeVerifier.policy.baselinePolicyHash,
        }
      : undefined,
  });
});

app.use(verifierAccessControl(verifierApiToken));
app.use(express.json({ limit: "32kb" }));

app.post("/v1/sign-native-mint", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const attestation = req.body?.attestation as NativeMintAttestation;
    if (!attestation) throw new Error("Native mint attestation is required");
    const latest = await provider.getBlock("latest");
    if (!latest) throw new Error("Native destination head is unavailable");
    await validateNativeMintAttestation(
      attestation,
      nativeVerifier.policy,
      nativeStratoGet,
      nativeVerifier.bridge,
      BigInt(latest.timestamp),
    );
    const signature = await nativeVerifier.signer.signTypedData(
      {
        name: "StratoNativeRepresentationBridge",
        version: "1",
        chainId: destinationChainId,
        verifyingContract: nativeVerifier.destinationBridge,
      },
      NATIVE_MINT_V2_TYPES,
      attestation,
    );
    auditDecision(
      "sign_native_mint",
      attestation.sourceWithdrawalId,
      "approve",
      attestation.useInstantPath
        ? "verified instant withdrawal"
        : "verified Safe withdrawal",
    );
    res.json({
      attestationSigner: nativeVerifier.signerAddress,
      signature,
    });
  } catch (error) {
    auditDecision(
      "sign_native_mint",
      String(req.body?.attestation?.sourceWithdrawalId || ""),
      "reject",
      (error as Error).message,
    );
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        nativeVerifier?.signerAddress,
      ),
    });
  }
});

app.post("/v1/sign-native-refund", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const depositId = String(req.body?.depositId || "");
    const refund = req.body?.refund as NativeRedemptionRefund;
    if (!/^(0x)?[0-9a-f]{64}$/i.test(depositId)) {
      throw new Error("Invalid native deposit identity");
    }
    const latest = await provider.getBlock("latest");
    if (!latest) throw new Error("Native destination head is unavailable");
    const deposit = await validateNativeRedemptionRefund(
      depositId.replace(/^0x/i, ""),
      refund,
      nativeVerifier.policy,
      nativeStratoGet,
      nativeVerifier.bridge,
      BigInt(latest.timestamp),
    );
    validateNativeSettlementRoute(deposit);
    const verified = await verifyNativeRedemptionsBatch([deposit], nativeEvidenceRpc);
    if (verified.get(deposit.depositId) !== true) {
      throw new Error("Native refund requires confirmed original redemption evidence");
    }
    const signature = await nativeVerifier.signer.signTypedData(
      {
        name: "StratoNativeRepresentationBridge",
        version: "1",
        chainId: destinationChainId,
        verifyingContract: nativeVerifier.destinationBridge,
      },
      NATIVE_REFUND_TYPES,
      refund,
    );
    auditDecision(
      "sign_native_refund",
      refund.redemptionId,
      "approve",
      "verified STRATO refund decision",
    );
    res.json({
      attestationSigner: nativeVerifier.signerAddress,
      signature,
    });
  } catch (error) {
    auditDecision(
      "sign_native_refund",
      String(req.body?.refund?.redemptionId || ""),
      "reject",
      (error as Error).message,
    );
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        nativeVerifier?.signerAddress,
      ),
    });
  }
});

const getNativeSourceRecord = async <T>(
  mapping: "withdrawals" | "deposits",
  key: string,
): Promise<T> => {
  if (!nativeVerifier) throw new Error("Native verification is not configured");
  const response = await nativeStratoGet(
    `/cirrus/search/BlockApps-StratoNativeBridge-${mapping}`,
    {
      address: `eq.${nativeVerifier.sourceBridge}`,
      key: `eq.${key}`,
      select: "key,value",
      limit: "1",
    },
  );
  return parseNativeSourceRecord(mapping, key, response.data) as T;
};

const validateNativeSettlementRoute = (
  record: Pick<
    NativeDepositInfo | NativeWithdrawalInfo,
    "externalChainId" | "externalBridge" | "representationToken" | "stratoToken"
  >,
): void => {
  if (!nativeVerifier) throw new Error("Native verification is not configured");
  const routeAllowed = nativeVerifier.policy.routes.some(
    (route) =>
      normalize(route.stratoToken) === normalize(record.stratoToken) &&
      normalize(route.representationToken) ===
        normalize(record.representationToken),
  );
  if (
    String(record.externalChainId) !==
      nativeVerifier.policy.destinationChainId ||
    normalize(record.externalBridge) !==
      normalize(nativeVerifier.policy.destinationBridge) ||
    !routeAllowed
  ) {
    throw new Error("Native settlement route is rejected by verifier policy");
  }
};

app.post("/v1/attest-native-withdrawal", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const withdrawalId = String(req.body?.withdrawalId || "");
    const externalTxHash = String(req.body?.externalTxHash || "");
    const nativeMintProposalHash = String(req.body?.nativeMintProposalHash || "");
    if (!/^\d+$/.test(withdrawalId) || !/^0x[0-9a-f]{64}$/i.test(externalTxHash)) {
      throw new Error("Invalid native withdrawal settlement identity");
    }
    const withdrawal = await getNativeSourceRecord<NativeWithdrawalInfo>(
      "withdrawals",
      withdrawalId,
    );
    if (
      !["2", "10"].includes(String(withdrawal.bridgeStatus)) ||
      String(withdrawal.withdrawalId) !== withdrawalId
    ) {
      throw new Error("Native withdrawal is not pending settlement");
    }
    validateNativeSettlementRoute(withdrawal);
    await verifyNativeMint(
      withdrawal,
      BigInt(nativeVerifier.policy.sourceChainId),
      nativeVerifier.sourceBridge,
      externalTxHash,
      nativeEvidenceRpc,
    );
    const digest = await readSourceDigest(
      "getWithdrawalSettlementDigest",
      [withdrawalId, externalTxHash, nativeMintProposalHash],
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
      NATIVE_BRIDGE_DIGEST_ABI,
    );
    const transactionHash = await submitStratoAttestation(
      "attestWithdrawalSettlement",
      { id: withdrawalId, externalTxHash, nativeMintProposalHash },
      "StratoNativeBridge",
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest });
  } catch (error) {
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        settlementAttestorAddress,
      ),
    });
  }
});

app.post("/v1/attest-native-deposit", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const depositId = String(req.body?.depositId || "");
    if (!depositId) throw new Error("Invalid native deposit identity");
    const deposit = await getNativeSourceRecord<NativeDepositInfo>("deposits", depositId);
    if (
      !["1", "2"].includes(String(deposit.bridgeStatus)) ||
      String(deposit.depositId) !== depositId
    ) {
      throw new Error("Native deposit is not pending settlement");
    }
    validateNativeSettlementRoute(deposit);
    const verified = await verifyNativeRedemptionsBatch([deposit], nativeEvidenceRpc);
    if (verified.get(depositId) !== true) {
      throw new Error(verified.has(depositId)
        ? "Native redemption evidence does not match the deposit"
        : "Native redemption awaiting confirmations");
    }
    const digest = await readSourceDigest(
      "getDepositSettlementDigest",
      [depositId],
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
      NATIVE_BRIDGE_DIGEST_ABI,
    );
    const transactionHash = await submitStratoAttestation(
      "attestDepositSettlement",
      { depositId },
      "StratoNativeBridge",
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest });
  } catch (error) {
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        settlementAttestorAddress,
      ),
    });
  }
});

app.post("/v1/attest-native-cancellation", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const withdrawalId = String(req.body?.withdrawalId || "");
    const cancellationTxHash = String(req.body?.cancellationTxHash || "");
    if (
      !/^\d+$/.test(withdrawalId) ||
      !/^0x[0-9a-f]{64}$/i.test(cancellationTxHash)
    ) {
      throw new Error("Invalid native cancellation identity");
    }
    const withdrawal = await getNativeSourceRecord<NativeWithdrawalInfo>(
      "withdrawals",
      withdrawalId,
    );
    if (
      String(withdrawal.bridgeStatus) !== "10" ||
      String(withdrawal.withdrawalId) !== withdrawalId ||
      normalize(withdrawal.cancellationTxHash || "") !==
        normalize(cancellationTxHash)
    ) {
      throw new Error("Native cancellation evidence is not recorded");
    }
    validateNativeSettlementRoute(withdrawal);
    await verifyNativeMintCancellation(
      withdrawal,
      BigInt(nativeVerifier.policy.sourceChainId),
      nativeVerifier.sourceBridge,
      cancellationTxHash,
      nativeEvidenceRpc,
    );
    const digest = await readSourceDigest(
      "getWithdrawalCancellationDigest",
      [withdrawalId, cancellationTxHash],
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
      NATIVE_BRIDGE_DIGEST_ABI,
    );
    const transactionHash = await submitStratoAttestation(
      "attestWithdrawalCancellation",
      { id: withdrawalId, cancellationTxHash },
      "StratoNativeBridge",
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest });
  } catch (error) {
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        settlementAttestorAddress,
      ),
    });
  }
});

app.post("/v1/attest-native-refund", async (req, res) => {
  try {
    if (!nativeVerifier) throw new Error("Native verification is not configured");
    const depositId = String(req.body?.depositId || "");
    const refundTxHash = String(req.body?.refundTxHash || "");
    if (!depositId || !/^0x[0-9a-f]{64}$/i.test(refundTxHash)) {
      throw new Error("Invalid native refund settlement identity");
    }
    const deposit = await getNativeSourceRecord<NativeDepositInfo>("deposits", depositId);
    if (
      String(deposit.bridgeStatus) !== "7" ||
      String(deposit.depositId) !== depositId
    ) {
      throw new Error("Native deposit is not pending refund");
    }
    validateNativeSettlementRoute(deposit);
    await verifyNativeRedemptionRefund(deposit, refundTxHash, nativeEvidenceRpc);
    const digest = await readSourceDigest(
      "getDepositRefundDigest",
      [depositId, refundTxHash],
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
      NATIVE_BRIDGE_DIGEST_ABI,
    );
    const transactionHash = await submitStratoAttestation(
      "attestDepositRefund",
      { depositId, refundTxHash },
      "StratoNativeBridge",
      nativeVerifier.sourceBridge,
      nativeStratoNodeUrl,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest });
  } catch (error) {
    res.status(422).json({
      decision: "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(
        error,
        nativeVerifier?.policy.version || verifierPolicy.version,
        nativeVerifier?.digest || verifierPolicyDigest,
        settlementAttestorAddress,
      ),
    });
  }
});

for (const action of ["sign", "attest"] as const) {
  app.post(`/v1/${action}-deposit-refund`, async (req, res) => {
    try {
      const a = req.body.authorization as DepositRefundAuthorization;
      const deposit = req.body.deposit as DepositSettlementAttestation;
      if (!a || !/^(0x)?[0-9a-f]{40}$/i.test(a.depositRouter) || typeof a.depositId !== "string" || !/^\d+$/.test(a.depositId)) throw new Error("Invalid deposit refund identity");
      const params = { address: `eq.${sourceBridge}`, key: `eq.${destinationChainId}`,
        key2: `eq.${normalize(a.depositRouter)}`, key3: `eq.${a.depositId}`, select: "value", limit: "1" };
      const [record, refundVault] = await Promise.all([
        stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge-deposits", params),
        stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge-depositRefundVaults", params),
      ]);
      validateDepositRefundSource(a, deposit, record.data?.[0]?.value, refundVault.data?.[0]?.value,
        sourceChainId, sourceBridge, destinationChainId, destinationVault);
      if (action === "sign") {
        await validateDepositRefundEvidence(provider, a, deposit, verifierConfirmations);
        const signature = await kmsSigner.signTypedData({ name: "ExternalBridgeVault", version: "1",
          chainId: destinationChainId, verifyingContract: destinationVault }, DEPOSIT_REFUND_TYPES, a);
        res.json({ authorizationSigner: authorizationSignerAddress, signature });
      } else {
        const refundTxHash = String(req.body.refundTxHash || "");
        await validateDepositRefundCompletion(provider, a, refundTxHash, verifierConfirmations);
        const digest = await readSourceDigest("getDepositRefundDigest", [a.destinationChainId, a.depositRouter, a.depositId, refundTxHash]);
        const transactionHash = await submitStratoAttestation("attestDepositRefund", {
          externalChainId: a.destinationChainId, depositRouter: a.depositRouter, depositId: a.depositId, refundTxHash,
        });
        res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest });
      }
    } catch (error) {
      res.status(422).json({ decision: "reject", error: (error as Error).message,
        ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress) });
    }
  });
}

app.post("/v1/sign-withdrawal", async (req, res) => {
  try {
    const authorization = req.body as WithdrawalAuthorization;
    await Promise.all([
      validateSourceWithdrawal(authorization),
      validateDestination(authorization),
    ]);
    const policyReason = await enforceWithdrawalPolicy(authorization);
    const signature = await signWithKms(authorization);
    auditDecision(
      "sign_withdrawal",
      authorization.sourceWithdrawalId,
      "approve",
      policyReason,
    );
    res.json({ authorizationSigner: authorizationSignerAddress, signature });
  } catch (error) {
    const manualReview = error instanceof ManualReviewRequiredError;
    auditDecision(
      "sign_withdrawal",
      String(req.body?.sourceWithdrawalId || ""),
      manualReview ? "manual_review" : "reject",
      (error as Error).message,
    );
    console.error("Withdrawal authorization rejected", (error as Error).message);
    res.status(manualReview ? 409 : 422).json({
      decision: manualReview ? "manual_review" : "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress),
    });
  }
});

// Pre-flight policy decision for an INITIATED withdrawal. Runs the same
// checks as signing but issues no signature and does not require the
// authorization to be committed on STRATO, so the bridge service can learn
// about a manual-review demand before markWithdrawalReady starts the
// authorization clock.
app.post("/v1/check-withdrawal", async (req, res) => {
  try {
    const authorization = req.body as WithdrawalAuthorization;
    await Promise.all([
      validateSourceWithdrawal(authorization, [1], true, false),
      validateDestination(authorization),
    ]);
    const policyReason = await enforceWithdrawalPolicy(authorization);
    auditDecision(
      "check_withdrawal",
      authorization.sourceWithdrawalId,
      "approve",
      policyReason,
    );
    res.json({ decision: "approve", reason: policyReason });
  } catch (error) {
    const manualReview = error instanceof ManualReviewRequiredError;
    auditDecision(
      "check_withdrawal",
      String(req.body?.sourceWithdrawalId || ""),
      manualReview ? "manual_review" : "reject",
      (error as Error).message,
    );
    console.error("Withdrawal pre-flight rejected", (error as Error).message);
    res.status(manualReview ? 409 : 422).json({
      decision: manualReview ? "manual_review" : "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress),
    });
  }
});

app.post("/v1/attest-deposit", async (req, res) => {
  try {
    const deposit = req.body as DepositSettlementAttestation;
    const generationResponse = await stratoGet("/cirrus/search/BlockApps-ExternalAssetBridge-depositGenerations", {
      address: `eq.${sourceBridge}`, key: `eq.${deposit.externalChainId}`,
      key2: `eq.${normalize(deposit.depositRouter)}`, key3: `eq.${deposit.depositId}`, select: "value",
    });
    const expectedGeneration = String(generationResponse.data?.[0]?.value ?? "0");
    if (BigInt(deposit.externalChainId) !== destinationChainId) {
      throw new Error("Deposit destination chain mismatch");
    }
    const chain = await getDepositChainConfig(deposit.externalChainId);
    if (!chain.routers.some((router) => normalize(router) === normalize(deposit.depositRouter))) {
      throw new Error("Deposit router is not enabled by the source bridge");
    }
    const policyDecision = evaluateDepositPolicy(verifierPolicy, deposit);
    const manuallyReviewed =
      policyDecision.decision === "manual_review" &&
      (await isDepositReviewApproved(deposit));
    if (policyDecision.decision === "manual_review" && !manuallyReviewed) {
      throw Object.assign(new ManualReviewRequiredError(policyDecision.reason), { issues: [{ code: "MANUAL_REVIEW", details: {
        token: deposit.externalToken, required: deposit.externalTokenAmount, units: "external-token-base-units",
        limit: verifierPolicy.routes.find(route => normalize(route.externalToken) === normalize(deposit.externalToken) &&
          normalize(route.stratoToken) === normalize(deposit.stratoToken))?.maxAutoDepositAmount,
      } }] });
    }
    await validateDepositSettlement(
      provider,
      deposit,
      chain.vault,
      chain.routers,
      verifierConfirmations,
    );
    const sourceFallbackOnly = await validateSourceDepositRoute(deposit, true);
    const fallbackOnly = policyDecision.fallbackOnly === true || sourceFallbackOnly;
    const transactionHash = await submitStratoAttestation(
      fallbackOnly ? "attestDepositFallback" : "attestDepositSettlement",
      {
        externalChainId: deposit.externalChainId,
        depositRouter: deposit.depositRouter,
        depositId: deposit.depositId,
        externalSender: deposit.externalSender,
        externalToken: deposit.externalToken,
        externalTokenAmount: deposit.externalTokenAmount,
        externalTxHash: deposit.externalTxHash,
        stratoRecipient: deposit.stratoRecipient,
        stratoToken: deposit.stratoToken,
        action: deposit.action,
        actionToken: deposit.actionToken,
        minFinalOut: deposit.minFinalOut,
        expectedGeneration,
      },
    );
    auditDecision(
      "attest_deposit",
      `${deposit.externalChainId}:${deposit.depositId}`,
      "approve",
      fallbackOnly ? "verified deposit; source-token fallback only" : manuallyReviewed
        ? "STRATO governance approval satisfies local deposit policy"
        : policyDecision.reason,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, fallbackOnly });
  } catch (error) {
    const manualReview = error instanceof ManualReviewRequiredError;
    auditDecision(
      "attest_deposit",
      `${req.body?.externalChainId || ""}:${req.body?.depositId || ""}`,
      manualReview ? "manual_review" : "reject",
      (error as Error).message,
    );
    console.error("Deposit settlement attestation rejected", (error as Error).message);
    res.status(manualReview ? 409 : 422).json({
      decision: manualReview ? "manual_review" : "reject",
      error: (error as Error).message,
      ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress),
    });
  }
});

app.post("/v1/attest-release", async (req, res) => {
  try {
    const authorization = req.body
      .authorization as WithdrawalAuthorization;
    const reservationId = String(req.body.reservationId || "");
    const externalTxHash = String(req.body.externalTxHash || "");
    await Promise.all([
      validateSourceWithdrawal(authorization, [3], false),
      validateReleasedDestination(authorization, reservationId),
    ]);
    await validateWithdrawalRelease(
      provider,
      {
        withdrawalId: authorization.sourceWithdrawalId,
        reservationId,
        externalTxHash,
        token: authorization.token,
        recipient: authorization.recipient,
        amount: authorization.amount,
      },
      authorization.destinationVault,
      verifierConfirmations,
    );
    const transactionHash = await submitStratoAttestation(
      "attestWithdrawalRelease",
      {
        withdrawalId: authorization.sourceWithdrawalId,
        reservationId,
        externalTxHash,
      },
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash });
  } catch (error) {
    if (error instanceof WithdrawalReleasePendingError) {
      res.status(409).json({ decision: "pending_confirmations", error: error.message, ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress) });
      return;
    }
    console.error("Withdrawal release attestation rejected", (error as Error).message);
    res.status(422).json({ error: (error as Error).message, ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress) });
  }
});

const validateRpcIdentity = async (): Promise<void> => {
  const [externalChain, metadata] = await Promise.all([
    provider.send("eth_chainId", []),
    stratoGet("/strato-api/eth/v1.2/metadata", {}),
  ]);
  if (BigInt(externalChain) !== destinationChainId) throw new Error("External RPC chain ID mismatch");
  const networkId = metadata.data?.networkID;
  if (networkId == null || BigInt(networkId) !== sourceChainId) throw new Error("STRATO RPC network ID mismatch");
};

const validateRefundDestination = async (authorization: WithdrawalAuthorization): Promise<void> => {
  validateDestinationIdentity(authorization);
  const latest = await provider.getBlock("latest");
  if (!latest || latest.number < verifierConfirmations) throw new Error("Finalized vault state is unavailable");
  const blockTag = latest.number - verifierConfirmations;
  const block = await provider.getBlock(blockTag);
  if (!block || BigInt(block.timestamp) <= BigInt(authorization.deadline)) {
    throw new Error("Authorization has not expired in confirmed vault state");
  }
  const reservationId = await vault.getReservationId(
    authorization.sourceChainId, authorization.sourceBridge, authorization.sourceWithdrawalId,
  );
  const reservation = await vault.reservations(reservationId, { blockTag });
  const status = Number(reservation.status);
  if (status === 0) return;
  if (status !== 3 || normalize(reservation.authorizationDigest) !== normalize(
    TypedDataEncoder.hash(domain(authorization), AUTHORIZATION_TYPES, authorization),
  )) throw new Error("Vault reservation is not refundable");
};

app.post("/v1/attest-refund", async (req, res) => {
  try {
    const authorization = req.body.authorization as WithdrawalAuthorization;
    await validateRpcIdentity();
    await Promise.all([
      validateSourceWithdrawal(authorization, [3], false),
      validateRefundDestination(authorization),
    ]);
    const expectedDigest = await readSourceDigest("getWithdrawalRefundDigest", [authorization.sourceWithdrawalId]);
    const transactionHash = await submitStratoAttestation("attestWithdrawalRefund", {
      withdrawalId: authorization.sourceWithdrawalId, expectedDigest: expectedDigest.slice(2),
    });
    auditDecision("attest_refund", authorization.sourceWithdrawalId, "approve", "Confirmed non-payment and bound source state");
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash, digest: expectedDigest });
  } catch (error) {
    auditDecision("attest_refund", String(req.body?.authorization?.sourceWithdrawalId || ""), "reject", (error as Error).message);
    res.status(422).json({ error: (error as Error).message, ...verifierFailureDetails(error, verifierPolicy.version, verifierPolicyDigest, settlementAttestorAddress) });
  }
});

const validateNativeVerifierConfig = async (): Promise<void> => {
  if (!nativeVerifier) return;
  await validateAwsKmsAddress(nativeVerifier.kms);
  const [enabled, threshold] = await Promise.all([
    nativeVerifier.bridge.attestationSigners(nativeVerifier.signerAddress),
    nativeVerifier.bridge.attestationThreshold(),
  ]);
  if (!enabled) {
    throw new Error("Native KMS signer is not enabled on the representation bridge");
  }
  if (Number(threshold) < 2) {
    throw new Error("Native representation bridge attestation threshold must be at least two");
  }
};

const start = async () => {
  try {
    await validateRpcIdentity();
    [settlementAttestorAddress] = await Promise.all([
      validateSettlementVerifier(),
      validateAwsKmsAddress(kmsConfig),
      validatePolicyAgainstContracts(),
      validateNativeVerifierConfig(),
    ]);
    if (
      normalize(verifierPolicy.settlementAttestor) !==
      normalize(settlementAttestorAddress)
    ) {
      throw new Error(
        "Verifier policy settlement attestor does not match STRATO account",
      );
    }
    app.listen(port, () => {
      console.log(
        `External bridge verifier listening on port ${port}; settlement attestor ${settlementAttestorAddress}`,
      );
    });
  } catch (error) {
    console.error(
      "External bridge signer configuration rejected",
      (error as Error).message,
    );
    process.exit(1);
  }
};

void start();

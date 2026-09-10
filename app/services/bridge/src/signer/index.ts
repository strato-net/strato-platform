import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import express from "express";
import {
  Contract,
  JsonRpcProvider,
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
  "function tokenPolicies(address) view returns (bool enabled,uint256 maxPerWithdrawal,uint256 windowLimit,uint256 windowSeconds,uint256 windowStartedAt,uint256 releasedInWindow,uint256 manualReviewThreshold)",
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
const provider = new JsonRpcProvider(required("VERIFIER_RPC_URL"));
const vault = new Contract(destinationVault, VAULT_ABI, provider);
const kmsConfig = {
  address: authorizationSignerAddress,
  keyId: required("KMS_KEY_ID"),
  region: required("KMS_REGION"),
};
const kmsSigner = new DigestKmsSigner(kmsConfig, provider);
const stratoNodeUrl = required("STRATO_NODE_URL").replace(/\/$/, "");
const sourceChainId = BigInt(required("SOURCE_CHAIN_ID"));
const sourceBridge = required("EXTERNAL_ASSET_BRIDGE_ADDRESS").replace(/^0x/, "");
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
      const discovery = await axios.get(signerOpenIdDiscoveryUrl);
      tokenEndpoint = discovery.data?.token_endpoint;
      if (!tokenEndpoint) throw new Error("OpenID token endpoint is unavailable");
    }
    const body = new URLSearchParams({
      grant_type: "password",
      username: signerBaUsername,
      password: signerBaPassword,
      scope: "openid email profile",
    });
    const response = await axios.post(tokenEndpoint, body.toString(), {
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

const stratoGet = async (path: string, params: Record<string, string>) => {
  const request = async () =>
    axios.get(`${stratoNodeUrl}${path}`, {
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

const submitStratoAttestation = async (
  method: string,
  args: Record<string, unknown>,
): Promise<string> => {
  const request = async () =>
    axios.post(
      `${stratoNodeUrl}/strato/v2.3/transaction/parallel?resolve=true`,
      {
        txs: [
          {
            type: "FUNCTION",
            payload: {
              contractName: "ExternalAssetBridge",
              contractAddress: sourceBridge,
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
        `${stratoNodeUrl}/bloc/v2.2/transactions/results`,
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
  return address;
};

const normalize = (value: string): string => value.replace(/^0x/, "").toLowerCase();

const validateSourceWithdrawal = async (
  authorization: WithdrawalAuthorization,
): Promise<void> => {
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
  if (!withdrawal || Number(withdrawal.status) !== 3) {
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

  const authorizationResponse = await stratoGet(
    "/cirrus/search/BlockApps-ExternalAssetBridge-withdrawalAuthorizations",
    {
      address: `eq.${sourceBridge}`,
      key: `eq.${authorization.sourceWithdrawalId}`,
      select: "value",
    },
  );
  const sourceAuthorization = authorizationResponse.data?.[0]?.value;
  if (!matchesSourceWithdrawalAuthorization(sourceAuthorization, authorization)) {
    throw new Error("Source withdrawal authorization does not match request");
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
    !chain?.enabled ||
    normalize(chain.vault) !== normalize(authorization.destinationVault)
  ) {
    throw new Error("Destination vault is not enabled by the source bridge");
  }
};

const validateSourceDepositRoute = async (
  deposit: DepositSettlementAttestation,
): Promise<void> => {
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
    throw new Error("AUTO_ROUTE is not enabled by the source bridge");
  }
};

const isDepositPendingReview = async (
  deposit: DepositSettlementAttestation,
): Promise<boolean> => {
  const response = await stratoGet(
    "/cirrus/search/BlockApps-ExternalAssetBridge-deposits",
    {
      address: `eq.${sourceBridge}`,
      key: `eq.${deposit.externalChainId}`,
      key2: `eq.${normalize(deposit.depositRouter)}`,
      key3: `eq.${deposit.depositId}`,
      select: "value",
    },
  );
  return Number(response.data?.[0]?.value?.status) === 2;
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
    throw new ManualReviewRequiredError(local.reason);
  }
  return "executed Safe approval satisfies manual review";
};

const validatePolicyAgainstContracts = async (): Promise<void> => {
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
app.use(express.json());
app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${verifierApiToken}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    authorizationSigner: authorizationSignerAddress,
    settlementAttestor: settlementAttestorAddress,
    verifierConfirmations,
    destinationChainId: destinationChainId.toString(),
    destinationVault,
    policyVersion: verifierPolicy.version,
    policyDigest: verifierPolicyDigest,
    baselinePolicyHash: verifierPolicy.baselinePolicyHash,
    verifierIndex: verifierPolicy.verifierIndex,
  });
});

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
    });
  }
});

app.post("/v1/attest-deposit", async (req, res) => {
  try {
    const deposit = req.body as DepositSettlementAttestation;
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
      (await isDepositPendingReview(deposit));
    if (policyDecision.decision === "manual_review" && !manuallyReviewed) {
      throw new ManualReviewRequiredError(policyDecision.reason);
    }
    await validateDepositSettlement(
      provider,
      deposit,
      chain.vault,
      chain.routers,
      verifierConfirmations,
    );
    await validateSourceDepositRoute(deposit);
    const transactionHash = await submitStratoAttestation(
      "attestDepositSettlement",
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
      },
    );
    auditDecision(
      "attest_deposit",
      `${deposit.externalChainId}:${deposit.depositId}`,
      "approve",
      manuallyReviewed
        ? "STRATO operator review satisfies local deposit policy"
        : policyDecision.reason,
    );
    res.json({ settlementAttestor: settlementAttestorAddress, transactionHash });
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
      validateSourceWithdrawal(authorization),
      validateReleasedDestination(authorization, reservationId),
      validateWithdrawalRelease(
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
      ),
    ]);
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
    console.error("Withdrawal release attestation rejected", (error as Error).message);
    res.status(422).json({ error: (error as Error).message });
  }
});

const start = async () => {
  try {
    [settlementAttestorAddress] = await Promise.all([
      validateSettlementVerifier(),
      validateAwsKmsAddress(kmsConfig),
      validatePolicyAgainstContracts(),
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

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import express from "express";
import {
  Contract,
  JsonRpcProvider,
  Signature,
  TypedDataEncoder,
  getAddress,
  verifyTypedData,
} from "ethers";
import {
  matchesSourceWithdrawalAuthorization,
  validateSignerKmsUrl,
} from "./authorizationValidation";

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
  "function attestationSigners(address) view returns (bool)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
  "function signerSetVersion() view returns (uint256)",
];

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const destinationChainId = BigInt(required("DESTINATION_CHAIN_ID"));
const destinationVault = getAddress(required("DESTINATION_VAULT_ADDRESS"));
const signerAddress = getAddress(required("KMS_SIGNER_ADDRESS"));
const provider = new JsonRpcProvider(required("SIGNER_RPC_URL"));
const vault = new Contract(destinationVault, VAULT_ABI, provider);
const stratoNodeUrl = required("STRATO_NODE_URL").replace(/\/$/, "");
const sourceChainId = BigInt(required("SOURCE_CHAIN_ID"));
const sourceBridge = required("EXTERNAL_ASSET_BRIDGE_ADDRESS").replace(/^0x/, "");
const kmsSignerUrl = validateSignerKmsUrl(
  required("KMS_SIGNER_URL"),
  process.env.NODE_ENV === "production",
);
const kmsSignerApiToken = required("KMS_SIGNER_API_TOKEN");
const signerApiToken = required("EXTERNAL_BRIDGE_SIGNER_API_TOKEN");
const signerOpenIdDiscoveryUrl = required("SIGNER_OPENID_DISCOVERY_URL");
const signerClientId = required("SIGNER_CLIENT_ID");
const signerClientSecret = required("SIGNER_CLIENT_SECRET");
const signerBaUsername = required("SIGNER_BA_USERNAME");
const signerBaPassword = required("SIGNER_BA_PASSWORD");
const port = Number(process.env.PORT || 3004);

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

const validateDestination = async (
  authorization: WithdrawalAuthorization,
): Promise<void> => {
  if (
    BigInt(authorization.destinationChainId) !== destinationChainId ||
    getAddress(authorization.destinationVault) !== destinationVault
  ) {
    throw new Error("Destination mismatch");
  }
  const [latestBlock, validity, signerSetVersion, enabled] = await Promise.all([
    provider.getBlock("latest"),
    vault.maxAuthorizationValiditySeconds(),
    vault.signerSetVersion(),
    vault.attestationSigners(signerAddress),
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

const signWithKms = async (
  authorization: WithdrawalAuthorization,
): Promise<string> => {
  const digest = TypedDataEncoder.hash(
    domain(authorization),
    AUTHORIZATION_TYPES,
    authorization,
  );
  const response = await axios.post(
    kmsSignerUrl,
    { digest },
    { headers: authHeaders(kmsSignerApiToken) },
  );
  const signature = Signature.from(response.data?.signature).serialized;
  const recovered = verifyTypedData(
    domain(authorization),
    AUTHORIZATION_TYPES,
    authorization,
    signature,
  );
  if (getAddress(recovered) !== signerAddress) {
    throw new Error("KMS returned a signature from an unexpected key");
  }
  return signature;
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${signerApiToken}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    signer: signerAddress,
    destinationChainId: destinationChainId.toString(),
    destinationVault,
  });
});

app.post("/v1/sign-withdrawal", async (req, res) => {
  try {
    const authorization = req.body as WithdrawalAuthorization;
    await Promise.all([
      validateSourceWithdrawal(authorization),
      validateDestination(authorization),
    ]);
    const signature = await signWithKms(authorization);
    res.json({ signer: signerAddress, signature });
  } catch (error) {
    console.error("Withdrawal authorization rejected", (error as Error).message);
    res.status(422).json({ error: (error as Error).message });
  }
});

app.listen(port, () => {
  console.log(`External bridge signer listening on port ${port}`);
});

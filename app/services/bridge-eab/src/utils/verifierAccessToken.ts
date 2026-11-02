import { isAddress } from "ethers";
import {
  VERIFIER_ACCESS_DOMAIN,
  VERIFIER_ACCESS_RENEW_SECONDS,
  VERIFIER_ACCESS_TOKEN_TTL_SECONDS,
  VERIFIER_ACCESS_TYPES,
  VerifierAccessGrant,
  encodeVerifierAccessToken,
  normalizeVerifierUrl,
} from "../config/verifierAccess";
import { AwsKmsConfig, signTypedDataWithKms } from "./kmsSigner";

type TypedDataSigner = (
  config: AwsKmsConfig,
  domain: Record<string, any>,
  types: Record<string, Array<{ name: string; type: string }>>,
  value: Record<string, any>,
) => Promise<string>;

export const RUNTIME_ACCESS_VARIABLES = ["RUNTIME_ACCESS_ADDRESS", "RUNTIME_ACCESS_KMS_KEY_ID", "RUNTIME_ACCESS_KMS_REGION"];

// The runtime's access key (eab-runtime stack). The runtime calls verifiers only with tokens signed by this key.
export const getRuntimeAccessKmsConfig = (): AwsKmsConfig => {
  const address = process.env.RUNTIME_ACCESS_ADDRESS?.trim();
  const keyId = process.env.RUNTIME_ACCESS_KMS_KEY_ID?.trim();
  const region = process.env.RUNTIME_ACCESS_KMS_REGION?.trim();
  if (!address || !keyId || !region) {
    const missing = RUNTIME_ACCESS_VARIABLES.filter((name) => !process.env[name]?.trim());
    throw new Error(
      `The runtime access key is not configured (${missing.join(", ")} not set): verifiers accept only tokens ` +
      `signed by it, so set ${RUNTIME_ACCESS_VARIABLES.join(", ")}`,
    );
  }
  if (!isAddress(address)) throw new Error("RUNTIME_ACCESS_ADDRESS must be a valid address");
  return { address, keyId, region };
};

const cache = new Map<string, { token: string; expiresAt: number }>();

export const clearVerifierAccessCache = (): void => cache.clear();

export const validateVerifierRuntimeAccess = async (
  urls: string[],
  runtimeAccessAddress: string,
  label: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> => {
  const metadata = await Promise.all(urls.map(async (url) => {
    const response = await fetchImpl(`${url}/health`);
    if (!response.ok) throw new Error(`${label} ${url} health returned ${response.status}`);
    return (await response.json()) as {
      access?: { runtimeAccessAddress?: string | null; verifierUrl?: string | null };
    };
  }));
  metadata.forEach((health, index) => {
    if (String(health.access?.runtimeAccessAddress || "").toLowerCase() !== runtimeAccessAddress.toLowerCase()) {
      throw new Error(`${label} ${urls[index]} does not accept signed access from runtime access address ${runtimeAccessAddress}`);
    }
    if (health.access?.verifierUrl !== normalizeVerifierUrl(urls[index])) {
      throw new Error(`${label} ${urls[index]} reports a different VERIFIER_PUBLIC_URL`);
    }
  });
};

export const verifierAuthorizationHeader = async (
  url: string,
  chainId: bigint | number | string,
  options: { now?: () => number; sign?: TypedDataSigner } = {},
): Promise<{ Authorization: string }> => {
  const kms = getRuntimeAccessKmsConfig();
  const verifier = normalizeVerifierUrl(url);
  const chain = BigInt(chainId).toString();
  const key = `${verifier}|${chain}`;
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  const cached = cache.get(key);
  if (cached && cached.expiresAt - now > VERIFIER_ACCESS_RENEW_SECONDS) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  const grant: VerifierAccessGrant = { verifier, chainId: chain, expiresAt: now + VERIFIER_ACCESS_TOKEN_TTL_SECONDS };
  const signature = await (options.sign ?? signTypedDataWithKms)(kms, VERIFIER_ACCESS_DOMAIN, VERIFIER_ACCESS_TYPES, grant);
  const token = encodeVerifierAccessToken(grant, signature);
  cache.set(key, { token, expiresAt: grant.expiresAt });
  return { Authorization: `Bearer ${token}` };
};

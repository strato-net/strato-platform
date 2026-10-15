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

// The runtime's access key (eab-runtime stack). Without it the runtime sends the legacy bearer tokens.
export const getRuntimeAccessKmsConfig = (): AwsKmsConfig | undefined => {
  const address = process.env.RUNTIME_ACCESS_ADDRESS?.trim();
  const keyId = process.env.RUNTIME_ACCESS_KMS_KEY_ID?.trim();
  const region = process.env.RUNTIME_ACCESS_KMS_REGION?.trim();
  if (!address && !keyId && !region) return undefined;
  if (!address || !isAddress(address) || !keyId || !region) {
    throw new Error("RUNTIME_ACCESS_ADDRESS, RUNTIME_ACCESS_KMS_KEY_ID and RUNTIME_ACCESS_KMS_REGION must be set together");
  }
  return { address, keyId, region };
};

export const signedVerifierAccessConfigured = (): boolean => getRuntimeAccessKmsConfig() !== undefined;

// One verifier per URL, so a credential is either the runtime's signed access or one legacy token per URL.
export const verifierCredentialsError = (urls: string[], tokens: string[]): string | undefined => {
  if (signedVerifierAccessConfigured()) return undefined;
  if (tokens.length !== urls.length) return "one API token per verifier URL, or the runtime access key";
  return undefined;
};

const cache = new Map<string, { token: string; expiresAt: number }>();

export const clearVerifierAccessCache = (): void => cache.clear();

export const verifierAuthorizationHeader = async (
  url: string,
  chainId: bigint | number | string,
  legacyToken: string | undefined,
  options: { now?: () => number; sign?: TypedDataSigner } = {},
): Promise<{ Authorization: string }> => {
  const kms = getRuntimeAccessKmsConfig();
  if (!kms) {
    if (!legacyToken) throw new Error(`No API token or runtime access key for verifier ${url}`);
    return { Authorization: `Bearer ${legacyToken}` };
  }
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

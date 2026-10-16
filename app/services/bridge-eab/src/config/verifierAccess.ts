export const VERIFIER_REQUESTS_PER_MINUTE = 120;
export const VERIFIER_AUTH_ATTEMPTS_PER_MINUTE = 30;
export const VERIFIER_RATE_LIMIT_MAX_CLIENTS = 1024;
export const MIN_SERVICE_TOKEN_LENGTH = 32;

// Signed verifier access: the runtime signs a short-lived token with its KMS access key for one verifier,
// and the verifier accepts it only from the configured runtime access address. No shared secret exists.
export const VERIFIER_ACCESS_TOKEN_PREFIX = "eab-access-v1.";
export const VERIFIER_ACCESS_TOKEN_TTL_SECONDS = 300;
export const VERIFIER_ACCESS_CLOCK_TOLERANCE_SECONDS = 60;
// The runtime signs a new token once less than this remains of the cached one.
export const VERIFIER_ACCESS_RENEW_SECONDS = 60;
export const VERIFIER_ACCESS_DOMAIN = { name: "EAB verifier access", version: "1" };
export const VERIFIER_ACCESS_TYPES = {
  VerifierAccess: [
    { name: "verifier", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
};

export interface VerifierAccessGrant {
  verifier: string;
  chainId: string;
  expiresAt: number;
}

// The audience both sides compare: scheme, host and port of the verifier's public URL, in lower case.
export const normalizeVerifierUrl = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Verifier URL must use https");
  }
  return parsed.origin.toLowerCase();
};

export const encodeVerifierAccessToken = (grant: VerifierAccessGrant, signature: string): string =>
  `${VERIFIER_ACCESS_TOKEN_PREFIX}${Buffer.from(JSON.stringify(grant)).toString("base64url")}.${signature}`;

export const decodeVerifierAccessToken = (
  token: string,
): { grant: VerifierAccessGrant; signature: string } | undefined => {
  if (!token.startsWith(VERIFIER_ACCESS_TOKEN_PREFIX) || token.length > 2048) return undefined;
  const body = token.slice(VERIFIER_ACCESS_TOKEN_PREFIX.length);
  const separator = body.lastIndexOf(".");
  if (separator <= 0) return undefined;
  const signature = body.slice(separator + 1);
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return undefined;
  let grant: unknown;
  try {
    grant = JSON.parse(Buffer.from(body.slice(0, separator), "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const value = grant as Partial<VerifierAccessGrant>;
  if (
    !value || typeof value !== "object" || Object.keys(value).length !== 3 ||
    typeof value.verifier !== "string" || value.verifier.length > 512 ||
    typeof value.chainId !== "string" || !/^[1-9][0-9]{0,77}$/.test(value.chainId) ||
    !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= 0
  ) {
    return undefined;
  }
  return { grant: value as VerifierAccessGrant, signature };
};

import axios from "axios";

const TOKEN_LIFETIME_THRESHOLD_MS = 10_000;
let tokenEndpoint: string | null = null;
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getTokenEndpoint(discoveryUrl: string): Promise<string> {
  if (tokenEndpoint) return tokenEndpoint;
  const { data } = await axios.get(discoveryUrl, { timeout: 10_000 });
  const endpoint = data?.token_endpoint;
  if (!endpoint) throw new Error("token_endpoint not found in discovery document");
  tokenEndpoint = endpoint;
  return endpoint;
}

/**
 * Get operator access token via OAuth2 client credentials.
 * Uses OPERATOR_CLIENT_ID, OPERATOR_CLIENT_SECRET, OPERATOR_DISCOVERY_URL.
 */
export async function getOperatorToken(): Promise<string> {
  const clientId = process.env.OPERATOR_CLIENT_ID;
  const clientSecret = process.env.OPERATOR_CLIENT_SECRET;
  const discoveryUrl = process.env.OPERATOR_DISCOVERY_URL;
  if (!clientId || !clientSecret || !discoveryUrl) {
    throw new Error("OPERATOR_CLIENT_ID, OPERATOR_CLIENT_SECRET, and OPERATOR_DISCOVERY_URL are required");
  }
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + TOKEN_LIFETIME_THRESHOLD_MS) {
    return cachedToken;
  }
  const endpoint = await getTokenEndpoint(discoveryUrl);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const { data } = await axios.post(
    endpoint,
    body.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      timeout: 10_000,
    }
  );
  const accessToken = data?.access_token;
  if (!accessToken) throw new Error("No access_token in OAuth response");
  cachedToken = accessToken;
  const expiresIn = (typeof data.expires_in === "number" ? data.expires_in : 3600) * 1000;
  tokenExpiry = now + expiresIn;
  return accessToken;
}

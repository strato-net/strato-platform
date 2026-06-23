// OAuth (Authorization Code + PKCE) login against the STRATO node's OIDC provider
// (Keycloak). Runs in the background service worker via chrome.identity. The
// resulting access token is used as `Authorization: Bearer` for the node's vault
// signature + user-identity endpoints (a "remote signer" account). No private key
// for these accounts ever lives in the extension.

const SCOPE = "openid email profile offline_access";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  tokenEndpoint: string;
  clientId: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return b64url(bytes).slice(0, len);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}

async function discover(issuer: string): Promise<Discovery> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  const d = await res.json();
  if (!d.authorization_endpoint || !d.token_endpoint) {
    throw new Error("OIDC discovery missing endpoints");
  }
  return d;
}

/** Run the interactive login and return tokens. Must run in the background SW. */
export async function loginWithStrato(
  issuer: string,
  clientId: string
): Promise<OAuthTokens> {
  if (!issuer || !clientId) {
    throw new Error("Network is missing oauthIssuer / oauthClientId (set in Settings)");
  }
  const { authorization_endpoint, token_endpoint } = await discover(issuer);
  const redirectUri = browser.identity.getRedirectURL();
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(32);

  const authUrl =
    `${authorization_endpoint}?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString();

  const redirect = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!redirect) throw new Error("Login window closed");

  const u = new URL(redirect);
  if (u.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
  const code = u.searchParams.get("code");
  if (!code) {
    const err =
      u.searchParams.get("error_description") || u.searchParams.get("error") || "no code";
    throw new Error(`OAuth failed: ${err}`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  const j = await res.json();
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (Number(j.expires_in) || 300) * 1000,
    tokenEndpoint: token_endpoint,
    clientId,
  };
}

/** Refresh an access token; throws if the refresh token is missing/expired. */
export async function refreshTokens(t: OAuthTokens): Promise<OAuthTokens> {
  if (!t.refreshToken) throw new Error("Session expired (no refresh token); log in again");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refreshToken,
    client_id: t.clientId,
  });
  const res = await fetch(t.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}); log in again`);
  const j = await res.json();
  return {
    ...t,
    accessToken: j.access_token,
    refreshToken: j.refresh_token || t.refreshToken,
    expiresAt: Date.now() + (Number(j.expires_in) || 300) * 1000,
  };
}

/**
 * Fetch the STRATO blockchain address for a logged-in token. The node maps the
 * OAuth identity to a vault-managed key (get-or-create). GET avoids CSRF (nginx
 * only enforces CSRF on mutating methods).
 */
export async function fetchAddress(
  userInfoUrl: string,
  accessToken: string
): Promise<{ address: string; username?: string }> {
  const res = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`User lookup failed (${res.status}) at ${userInfoUrl}`);
  const d = await res.json();
  const address: string | undefined = d.userAddress || d.address;
  if (!address) throw new Error("Node did not return an address for this account");
  return {
    address: address.startsWith("0x") ? address : `0x${address}`,
    username: d.userName || d.username,
  };
}

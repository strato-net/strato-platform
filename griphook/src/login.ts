import http from "http";
import { URL } from "url";
import { randomBytes, createHash } from "crypto";
import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";

interface OpenIdConfiguration {
  token_endpoint: string;
  authorization_endpoint: string;
  issuer: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  openIdDiscoveryUrl: string;
  clientId: string;
}

const CREDENTIALS_DIR = path.join(os.homedir(), ".griphook");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials.json");

/**
 * Generate a cryptographically random string for PKCE code verifier
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate PKCE code challenge from verifier using S256 method
 */
function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Fetch OpenID Connect configuration
 */
async function fetchOpenIdConfig(discoveryUrl: string): Promise<OpenIdConfiguration> {
  const response = await axios.get<OpenIdConfiguration>(discoveryUrl, { timeout: 10000 });
  return response.data;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(port: number): Promise<{ code: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Failed</h1>
                <p>${errorDescription || error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          reject(new Error(`OAuth error: ${errorDescription || error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>Authentication Successful</h1>
                <p>You can close this window and return to the terminal.</p>
                <script>setTimeout(() => window.close(), 2000);</script>
              </body>
            </html>
          `);
          resolve({ code, server });
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing authorization code");
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(port, "127.0.0.1", () => {
      // Server started
    });

    server.on("error", reject);

    // Timeout after 5 minutes
    setTimeout(() => {
      reject(new Error("Login timed out - no callback received within 5 minutes"));
      server.close();
    }, 5 * 60 * 1000);
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string | undefined,
  redirectUri: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  // Add client_secret for confidential clients
  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }

  const response = await axios.post<TokenResponse>(tokenEndpoint, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });

  return response.data;
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(
  openIdDiscoveryUrl: string,
  clientId: string,
  refreshToken: string
): Promise<TokenResponse> {
  const config = await fetchOpenIdConfig(openIdDiscoveryUrl);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const response = await axios.post<TokenResponse>(config.token_endpoint, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 30000,
  });

  return response.data;
}

/**
 * Save credentials to disk
 */
export function saveCredentials(credentials: StoredCredentials): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { mode: 0o700 });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Load credentials from disk
 */
export function loadCredentials(): StoredCredentials | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    const content = fs.readFileSync(CREDENTIALS_FILE, "utf8");
    return JSON.parse(content) as StoredCredentials;
  } catch {
    return null;
  }
}

/**
 * Clear stored credentials
 */
export function clearCredentials(): void {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Get credentials file path for display
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

/**
 * Perform browser-based OAuth login
 */
export async function login(options: {
  openIdDiscoveryUrl: string;
  clientId: string;
  clientSecret?: string;
  callbackPort?: number;
}): Promise<StoredCredentials> {
  const { openIdDiscoveryUrl, clientId, clientSecret, callbackPort = 8085 } = options;

  // Fetch OpenID configuration
  console.log("Fetching OpenID configuration...");
  const config = await fetchOpenIdConfig(openIdDiscoveryUrl);

  // Generate PKCE verifier and challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const redirectUri = `http://localhost:${callbackPort}/callback`;

  // Build authorization URL
  const authUrl = new URL(config.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Start callback server
  console.log("Starting local callback server...");
  const callbackPromise = startCallbackServer(callbackPort);

  // Open browser
  console.log("\nOpening browser for authentication...");
  console.log(`If browser doesn't open, visit:\n${authUrl.toString()}\n`);

  const open = await import("open");
  await open.default(authUrl.toString());

  // Wait for callback
  console.log("Waiting for authentication...");
  const { code, server } = await callbackPromise;

  // Exchange code for tokens
  console.log("Exchanging authorization code for tokens...");
  const tokens = await exchangeCodeForTokens(
    config.token_endpoint,
    code,
    codeVerifier,
    clientId,
    clientSecret,
    redirectUri
  );

  // Close callback server
  server.close();

  // Build credentials object
  const credentials: StoredCredentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    refreshExpiresAt: Date.now() + tokens.refresh_expires_in * 1000,
    openIdDiscoveryUrl,
    clientId,
  };

  // Save credentials
  saveCredentials(credentials);
  console.log(`\nCredentials saved to ${CREDENTIALS_FILE}`);

  return credentials;
}

/**
 * CLI entry point for login command
 */
export async function loginCommand(): Promise<void> {
  const openIdDiscoveryUrl = process.env.OPENID_DISCOVERY_URL;
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  if (!openIdDiscoveryUrl) {
    console.error("Error: OPENID_DISCOVERY_URL environment variable is required");
    process.exit(1);
  }

  if (!clientId) {
    console.error("Error: OAUTH_CLIENT_ID environment variable is required");
    process.exit(1);
  }

  try {
    const credentials = await login({ openIdDiscoveryUrl, clientId, clientSecret });

    // Decode token to show username
    const payload = credentials.accessToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    const username = decoded.preferred_username || decoded.email || decoded.sub;

    console.log(`\nLogged in as: ${username}`);
    console.log(`Token expires: ${new Date(credentials.expiresAt).toLocaleString()}`);
    console.log(`Refresh token expires: ${new Date(credentials.refreshExpiresAt).toLocaleString()}`);
  } catch (err) {
    if (err instanceof Error) {
      console.error(`\nLogin failed: ${err.message}`);
      if (err.stack) {
        console.error(err.stack);
      }
    } else {
      console.error(`\nLogin failed: ${err}`);
    }
    process.exit(1);
  }
}

/**
 * CLI entry point for logout command
 */
export function logoutCommand(): void {
  clearCredentials();
  console.log("Logged out. Credentials cleared.");
}

/**
 * CLI entry point for status command
 */
export function statusCommand(): void {
  const credentials = loadCredentials();

  if (!credentials) {
    console.log("Not logged in. Run 'griphook login' to authenticate.");
    return;
  }

  const now = Date.now();
  const tokenValid = now < credentials.expiresAt;
  const refreshValid = now < credentials.refreshExpiresAt;

  // Decode token to show username
  try {
    const payload = credentials.accessToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    const username = decoded.preferred_username || decoded.email || decoded.sub;
    console.log(`Logged in as: ${username}`);
  } catch {
    console.log("Logged in (unable to decode token)");
  }

  console.log(`Access token: ${tokenValid ? "valid" : "expired"}`);
  console.log(`  Expires: ${new Date(credentials.expiresAt).toLocaleString()}`);
  console.log(`Refresh token: ${refreshValid ? "valid" : "expired"}`);
  console.log(`  Expires: ${new Date(credentials.refreshExpiresAt).toLocaleString()}`);
  console.log(`Credentials file: ${CREDENTIALS_FILE}`);

  if (!refreshValid) {
    console.log("\nRefresh token expired. Run 'griphook login' to re-authenticate.");
  }
}

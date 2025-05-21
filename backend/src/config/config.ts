import { fetchOpenIdTokenEndpoint } from "../utils/authHelper";

// Load local .env files when not in production
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// Verify the env vars
if (!process.env.OAUTH_DISCOVERY_URL) {
  throw new Error("OAUTH_DISCOVERY_URL is not defined");
}
if (!process.env.OAUTH_CLIENT_ID) {
  throw new Error("OAUTH_CLIENT_ID is not defined");
}
if (!process.env.OAUTH_CLIENT_SECRET) {
  throw new Error("OAUTH_CLIENT_SECRET is not defined");
}
if (!process.env.NODE_URL) {
  throw new Error("NODE_URL is not defined");
}
if (!process.env.NETWORK || !["prod", "testnet", "testnet2"].includes(process.env.NETWORK)) {
  console.warn("NETWORK env var is not defined or is not a valid value (prod|testnet|testnet2) - using the 'testnet2' preset by default.");
}

export let openIdTokenEndpoint: string | undefined;
/**
 * Init function to be called from the App.js to make sure the app is served after the token endpoint is asynchronously fetched from OpenID Discovery URL 
 */
export async function initOpenIdConfig() {
  openIdTokenEndpoint = await fetchOpenIdTokenEndpoint(process.env.OAUTH_DISCOVERY_URL);
}
export const clientId = process.env.OAUTH_CLIENT_ID;
export const clientSecret = process.env.OAUTH_CLIENT_SECRET;
export const nodeUrl = process.env.NODE_URL;
export const baseUrl = process.env.BASE_URL || "http://localhost";

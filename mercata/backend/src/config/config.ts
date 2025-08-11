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
export const poolFactory = process.env.POOL_FACTORY || "000000000000000000000000000000000000100a";
export const lendingRegistry = process.env.LENDING_REGISTRY || "0000000000000000000000000000000000001007";
export const onRamp = process.env.ONRAMP || "0000000000000000000000000000000000001009";
export const tokenFactory = process.env.TOKEN_FACTORY || "000000000000000000000000000000000000100b";
export const adminRegistry = process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c";

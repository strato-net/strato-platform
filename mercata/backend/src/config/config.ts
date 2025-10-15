import { fetchOpenIdConfig } from "../utils/authHelper";
import { JSONWebKeySet } from "jose";

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

// TODO: potentially add the TTL for cached values, to update values after a period of time
export let openIdTokenEndpoint: string | undefined;
export let openIdJwks: JSONWebKeySet | undefined;
/**
 * Init function to be called from the App.js to make sure the app is served after the token endpoint is asynchronously fetched from OpenID Discovery URL 
 */
export async function initOpenIdConfig() {
  const { tokenEndpoint, jwks } = await fetchOpenIdConfig(process.env.OAUTH_DISCOVERY_URL);
  openIdTokenEndpoint = tokenEndpoint;
  openIdJwks = jwks;
}
export const clientId = process.env.OAUTH_CLIENT_ID;
export const clientSecret = process.env.OAUTH_CLIENT_SECRET;
export const nodeUrl = process.env.NODE_URL;
export const baseUrl = process.env.BASE_URL || "http://localhost";
export const poolConfigurator = process.env.POOL_CONFIGURATOR || "0000000000000000000000000000000000001006";
export const lendingRegistry = process.env.LENDING_REGISTRY || "0000000000000000000000000000000000001007";
export const mercataBridge = process.env.MERCATA_BRIDGE || "0000000000000000000000000000000000001008";
export const poolFactory = process.env.POOL_FACTORY || "000000000000000000000000000000000000100a";
export const tokenFactory = process.env.TOKEN_FACTORY || "000000000000000000000000000000000000100b";
export const adminRegistry = process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c";
export const voucher = process.env.VOUCHER_CONTRACT_ADDRESS || "000000000000000000000000000000000000100e";
export const cdpRegistry = process.env.CDP_REGISTRY || "0000000000000000000000000000000000001012";
export const rewardsChef = process.env.REWARDS_CHEF || "000000000000000000000000000000000000101f";
export const wagmiProjectId = process.env.WAGMI_PROJECT_ID || "PROJECT_ID_UNSET";

// Load local .env files when not in production
import { fetchOpenIdTokenEndpoint } from "../utils/authHelper";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
if (!process.env.ONRAMP) {
  throw new Error("ONRAMP is not defined");
}

export let openIdTokenEndpoint: string | undefined;
/**
 * Init function to be called from the App.js to make sure the app is served after the token endpoint is asynchronously fetched from OpenID Discovery URL
 */
export async function initOpenIdConfig() {
  openIdTokenEndpoint = await fetchOpenIdTokenEndpoint(process.env.OAUTH_DISCOVERY_URL);
}

export const clientSecret = process.env.CLIENT_SECRET;
export const clientId = process.env.CLIENT_ID;
export const nodeUrl = process.env.NODE_URL;
export const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
export const stripeWebhookKey = process.env.STRIPE_WEBHOOK_SECRET || "";
export const onRamp = process.env.ONRAMP;
export const voucher = process.env.VOUCHER;
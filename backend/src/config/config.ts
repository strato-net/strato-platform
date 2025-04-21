// Load local .env files when not in production
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

export const clientSecret = process.env.CLIENT_SECRET;
export const clientId = process.env.CLIENT_ID;
export const openIdDiscoveryUrl = process.env.OPENID_DISCOVERY_URL;
export const nodeUrl = process.env.NODE_URL;
export const serverHost = process.env.SERVER_HOST;

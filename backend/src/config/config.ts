// Load local .env files when not in production
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

export const clientSecret = process.env.CLIENT_SECRET;
export const clientId = process.env.CLIENT_ID;
export const openIdTokenEndpoint = process.env.OPENID_TOKEN_ENDPOINT;
export const nodeUrl = process.env.NODE_URL;
export const baseCodeCollection = process.env.BASE_CODE_COLLECTION;

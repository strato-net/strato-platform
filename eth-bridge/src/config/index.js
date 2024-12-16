require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  clientSecret: process.env.CLIENT_SECRET,
  CLIENT_ID: process.env.CLIENT_ID,
  openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  marketplaceUrl: process.env.MARKETPLACE_URL,
  ETHSTAddress: process.env.ETHST_ADDRESS,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  alchemyNetwork: process.env.ALCHEMY_NETWORK,
  blockAppsPrivateKey: process.env.BLOCKAPPS_PRIVATE_KEY,
  mintAndTransfer: "mintETHST",
};

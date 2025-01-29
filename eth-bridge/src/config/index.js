require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  clientSecret: process.env.CLIENT_SECRET,
  CLIENT_ID: process.env.CLIENT_ID,
  openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  marketplaceUrl: process.env.MARKETPLACE_URL,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  alchemyNetwork: process.env.ALCHEMY_NETWORK,
  blockAppsPublicKey: process.env.BLOCKAPPS_PUBLIC_KEY,
  blockAppsPrivateKey: process.env.BLOCKAPPS_PRIVATE_KEY,
  wbtcContractAddress: process.env.WBTC_CONTRACT_ADDRESS,
  
  usdtContractAddress: process.env.USDT_CONTRACT_ADDRESS,
  usdcContractAddress: process.env.USDC_CONTRACT_ADDRESS,
  paxgContractAddress: process.env.PAXG_CONTRACT_ADDRESS,
  mintAndTransfer: "mintETHST",
};

require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  testnetClientSecret: process.env.TESTNET_CLIENT_SECRET,
  prodClientSecret: process.env.PROD_CLIENT_SECRET,
  NODE: process.env.NODE, // prod or testnet
  prodMarketplaceUrl: process.env.PROD_MARKETPLACE_URL,
  testnetMarketplaceUrl: process.env.TESTNET_MARKETPLACE_URL,
  prodStratsAddress: process.env.PROD_STRATS_ADDRESS,
  testnetStratsAddress: process.env.TESTNET_STRATS_ADDRESS,
  contractName: "ERC20Dapp",
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

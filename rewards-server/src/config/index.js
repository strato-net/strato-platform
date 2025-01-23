require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  testnetClientSecret: process.env.TESTNET_CLIENT_SECRET,
  prodClientSecret: process.env.PROD_CLIENT_SECRET,
  NODE_ENV: process.env.NODE_ENV, // prod or testnet
  CLIENT_ID: process.env.CLIENT_ID,
  prodMarketplaceUrl: process.env.PROD_MARKETPLACE_URL,
  testnetMarketplaceUrl: process.env.TESTNET_MARKETPLACE_URL,
  prodUSDSTAddress: process.env.PROD_USDST_ADDRESS,
  testnetUSDSTAddress: process.env.TESTNET_USDST_ADDRESS,
  contractName: process.env.CONTRACT_NAME,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  notificationUrl: process.env.NOTIFICATION_SERVER_URL
};

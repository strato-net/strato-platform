require("dotenv").config();

module.exports = {
  baUsername: process.env.BA_USERNAME,
  baPassword: process.env.BA_PASSWORD,
  testnetClientSecret: process.env.TESTNET_CLIENT_SECRET,
  prodClientSecret: process.env.PROD_CLIENT_SECRET,
  NODE: process.env.NODE, // prod or testnet
  prodMarketplaceUrl: "marketplace.mercata.blockapps.net",
  testnetMarketplaceUrl: "marketplace.mercata-testnet2.blockapps.net",
  prodStratsAddress: "b220195543f652f735b7847c4af399d0323e1ff6",
  testnetStratsAddress: "488cd3909d94606051e0684cf6caa5763fb78613",
  contractName: "ERC20Dapp",
};

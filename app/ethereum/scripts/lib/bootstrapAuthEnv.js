const path = require("path");
const dotenv = require("dotenv");

function bootstrapAuthEnv() {
  // Load contract deploy env to reuse the same OAuth + deployer credentials.
  dotenv.config({
    path: path.resolve(__dirname, "../../../contracts/.env"),
    override: false,
  });

  const mappings = [
    ["OAUTH_CLIENT_ID", "CLIENT_ID"],
    ["OAUTH_CLIENT_SECRET", "CLIENT_SECRET"],
    ["OAUTH_URL", "OPENID_DISCOVERY_URL"],
    ["GLOBAL_ADMIN_NAME", "BA_USERNAME"],
    ["GLOBAL_ADMIN_PASSWORD", "BA_PASSWORD"],
  ];

  for (const [sourceKey, targetKey] of mappings) {
    const sourceValue = process.env[sourceKey];
    if (!sourceValue) continue;
    process.env[targetKey] = sourceValue;
  }
}

module.exports = {
  bootstrapAuthEnv,
};


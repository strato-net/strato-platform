// Load environment variables from .env file.
require("dotenv").config();

const fs = require("fs");
const { rest, util, fsUtil, oauthUtil } = require("blockapps-rest");

// Load configuration from a YAML file.
const config = fsUtil.getYaml(`../config.yaml`);

/**
 * Obtains a user token using OAuth resource owner credentials.
 *
 * @param {string} username - The username to use.
 * @param {string} password - The password to use.
 * @param {object|null} req - (Optional) Express request object to extract the OAuth instance.
 * @returns {Promise<string>} - The access token.
 */
const getUserToken = async (username, password, req = null) => {
  const oauth = req ? req.app.oauth : await oauthUtil.init(config.nodes[0].oauth);
  const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(username, password);
  const tokenField = config.nodes[0].oauth.tokenField || "access_token";
  return tokenObj.token[tokenField];
};

async function main() {
  try {
    // Validate that required environment variables are present.
    const { USERNAME, PASSWORD } = process.env;
    if (!USERNAME || !PASSWORD) {
      throw new Error("USERNAME and PASSWORD environment variables are required.");
    }

    // 1. Obtain the user token via OAuth.
    const tokenString = await getUserToken(USERNAME, PASSWORD);
    if (!tokenString) {
      throw new Error("Failed to acquire token.");
    }
    console.log("Token acquired.");
    const token = { token: tokenString };

    // 2. Query reserves with creator=BlockApps and stratsToken not null.
    const reserveQuery = {
      config,
      query: {
        creator: "eq.BlockApps",
        stratsToken: "neq.null",
        select: "address,name,assetRootAddress"
      }
    };

    const reserves = await rest.search(token, { name: "BlockApps-Mercata-Reserve" }, reserveQuery);
    console.log(`Found ${reserves.length} reserves matching criteria.`);

    // 3. For each reserve, query active escrows.
    const results = [];
    for (const reserve of reserves) {
      const escrowQuery = {
        config,
        query: {
          reserve: "eq." + reserve.address,
          isActive: "eq.true",
          select: "address,borrowedAmount,collateralQuantity,collateralValue,maxLoanAmount,borrowerCommonName"
        }
      };

      const escrows = await rest.search(token, { name: "BlockApps-Mercata-Escrow" }, escrowQuery);
      console.log(`Reserve ${reserve.address} has ${escrows.length} active escrow(s).`);

      // Only include reserves that have at least one active escrow.
      if (escrows && escrows.length > 0) {
        results.push({
          reserve,
          escrows
        });
      }
    }

    // 4. Write the joined results to a file (formatted as JSON).
    const outputFile = "reserve_escrows.json";
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`Results written to ${outputFile}`);
  } catch (error) {
    console.error("Fatal error:", error);
  }
}

main();
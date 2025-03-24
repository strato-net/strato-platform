import { assert } from "chai";
import { rest } from "blockapps-rest";
import config from "./load.config.js";
import deployment from "./load.deploy.js";
import oauthHelper from "./helpers/oauthHelper.js";

async function deactivate(token, contract) {
  const { metal, ...restContract } = contract;

  const callArgs = {
    contract: restContract,
    method: "deactivate",
    args: {},
  };
  await rest.call(token, callArgs, { config, cacheNonce: true });
}

describe("Oracle - deactivate contracts", function () {
  this.timeout(config.timeout);

  let token;

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      "configDirPath is missing. Set in config"
    );
    try {
      token = await oauthHelper.getServiceToken();
    } catch (e) {
      console.error(
        "ERROR: Unable to fetch the service token, check the OAuth credentials in config.yaml",
        e
      );
      throw e;
    }
  });

  it("Deactivate all oracle contracts", async () => {
    for (const contractName in deployment.contracts) {
      if (deployment.contracts.hasOwnProperty(contractName)) {
        const contract = deployment.contracts[contractName];
        if (contract) {
          console.log(`Deactivating ${contractName}...`);
          await deactivate(token, contract);
        }
      }
    }
  });
});

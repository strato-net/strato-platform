import fs from "fs";
import { assert } from "chai";
import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import config from "./load.config.js";
import oauthHelper from "./helpers/oauthHelper.js";
import { yamlWrite, yamlSafeDumpSync } from "./helpers/config.js";
import { replaceInFiles } from "./helpers/replaceInFiles.js";

const contractDir =
  config.contractDirPath ||
  "/usr/src/payment-server/dapp/mercata-base-contracts/Templates";
const assetsDir =
  config.assetsDirPath || "/usr/src/payment-server/dapp/items/contracts";

// Read the oracle configuration from /tmp/oracle.json
const oracleConfigPath = "/tmp/oracle.json";
if (!fs.existsSync(oracleConfigPath)) {
  throw new Error("Oracle configuration file not found at " + oracleConfigPath);
}
const oracleConfig = JSON.parse(fs.readFileSync(oracleConfigPath, "utf8"));
const oraclesList = oracleConfig.oracles; // the list of oracles

async function uploadContract(token, type, oracle) {
  const contractName = `SimpleOracleService`;
  const filename = `${contractDir}/${type}s/${contractName}.sol`;
  const source = await importer.combine(filename);
  const contractArgs = {
    name: contractName,
    source,
    args: util.usc({ name: oracle.name }),
  };

  const options = {
    config,
    history: [contractName],
    cacheNonce: true,
  };

  const { address } = await createContract(token, contractArgs, options);

  return {
    address,
    ...oracle,
  };
}

function deploy(args) {
  // author the deployment
  const { deployFilePath, ...restArgs } = args;

  const deployment = {
    url: config.nodes[0].url,
    contracts: restArgs,
  };

  console.log("deploy filename:", deployFilePath);
  console.log(yamlSafeDumpSync(deployment));

  yamlWrite(deployment, deployFilePath);

  return deployment;
}

describe("Payment Server - deploy contracts", function () {
  this.timeout(config.timeout);

  let token;
  let deployedOracles = {};

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      "configDirPath is  missing. Set in config"
    );
    assert.isDefined(
      process.env.BASE_CODE_COLLECTION,
      "Environment variable BASE_CODE_COLLECTION is missing. Set in .env"
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
    try {
      replaceInFiles(
        contractDir,
        "BASE_CODE_COLLECTION",
        process.env.BASE_CODE_COLLECTION
      );
      replaceInFiles(
        assetsDir,
        "BASE_CODE_COLLECTION",
        process.env.BASE_CODE_COLLECTION
      );
    } catch (e) {
      console.error(
        "ERROR: unable to insert BASE_CODE_COLLECTION address to contract files",
        e
      );
    }
  });

  after(async () => {
    try {
      replaceInFiles(
        contractDir,
        process.env.BASE_CODE_COLLECTION,
        "BASE_CODE_COLLECTION"
      );
      replaceInFiles(
        assetsDir,
        process.env.BASE_CODE_COLLECTION,
        "BASE_CODE_COLLECTION"
      );
    } catch (e) {
      console.error(
        "ERROR: unable to remove BASE_CODE_COLLECTION address from contract files",
        e
      );
    }
  });

  // Deploy all oracles found in the JSON file
  it("Deploy all oracles", async () => {
    for (const oracle of oraclesList) {
      // Deploy each oracle contract dynamically
      const deployedOracle = await uploadContract(token, "Oracle", oracle);
      // Store the deployed oracle under its name
      deployedOracles[oracle.name] = deployedOracle;
    }
    // Optional: log the deployed oracles for verification
    console.log("Deployed Oracles:", deployedOracles);
  });

  // Create oracle_deploy.yaml
  it("Create oracle_deploy.yaml", async () => {
    const deployArgs = {
      deployFilePath: `${config.configDirPath}/oracle_deploy.yaml`,
      ...deployedOracles,
    };
    const deployment = deploy(deployArgs, config);
    assert.isDefined(deployment);
  });
});

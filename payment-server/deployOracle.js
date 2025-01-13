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

async function uploadContract(token, type, args) {
  const contractName = `SimpleOracleService`;
  const filename = `${contractDir}/${type}s/${contractName}.sol`;
  const source = await importer.combine(filename);
  const contractArgs = {
    name: contractName,
    source,
    args: util.usc(args),
  };

  const options = {
    config,
    history: [contractName],
    cacheNonce: true,
  };

  const { address } = await createContract(token, contractArgs, options);

  return {
    name: contractName,
    metal: args.name,
    address,
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

  let silverOracle;
  let goldOracle;
  let ethOracle;
  let usdOracle;

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

  it("Deploy Silver Oracle", async () => {
    const silverOracleName = config.silverOracle.name;
    silverOracle = await uploadContract(token, "Oracle", {
      name: silverOracleName,
    });
  });

  it("Deploy Gold Oracle", async () => {
    const goldOracleName = config.goldOracle.name;
    goldOracle = await uploadContract(token, "Oracle", {
      name: goldOracleName,
    });
  });

  it("Deploy Eth Oracle", async () => {
    const ethOracleName = config.ethOracle.name;
    ethOracle = await uploadContract(token, "Oracle", { name: ethOracleName });
  });

  it("Deploy USD Oracle", async () => {
    const usdOracleName = config.usdOracle.name;
    usdOracle = await uploadContract(token, "Oracle", { name: usdOracleName });
  });

  // Create oracle_deploy.yaml
  it("Create oracle_deploy.yaml", async () => {
    const deployArgs = {
      deployFilePath: `${config.configDirPath}/oracle_deploy.yaml`,
      silverOracle,
      goldOracle,
      ethOracle,
      usdOracle,
    };
    const deployment = deploy(deployArgs, config);
    assert.isDefined(deployment);
  });
});

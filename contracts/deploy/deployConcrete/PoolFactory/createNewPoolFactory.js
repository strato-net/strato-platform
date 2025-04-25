// Load environment variables from .env file.
require('dotenv').config();

const auth = require('../../auth');
const { rest, util, importer, fsUtil, oauthUtil } = require('blockapps-rest');
const fs = require('fs');
const path = require('path');

// Load configuration from a YAML file.
const config = fsUtil.getYaml(`../../config.yaml`);

async function main() {
  try {
    // Destructure and validate required environment variables.
    const {
      USERNAME,
      PASSWORD
    } = process.env;

    if (!USERNAME || !PASSWORD) {
      throw new Error(
        'USERNAME and PASSWORD environment variables are required.'
      );
    }

    // 1. Obtain the user token via OAuth.
    const tokenString = await auth.getUserToken(USERNAME, PASSWORD);
    if (!tokenString) {
      throw new Error('Failed to acquire token.');
    }
    console.log('Token acquired:', tokenString);
    const token = { token: tokenString };

    // 4. Set up contract details for deployment.
    // Be sure to have updated the SimpleReserve.sol contract with the correct Base Code Collection.
    const contractName = 'SimplePoolFactory';
    const contractFilename =
      '../../dapp/mercata-base-contracts/Templates/Pools/SimplePoolFactory.sol';
    const source = await importer.combine(contractFilename);

    // Build the constructor arguments.
    const constructorArgs = {};

    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(constructorArgs),
    };

    // Deployment options.
    const options = {
      config,
      history: contractName,
      cacheNonce: true,
      isAsync: true,
    };
    console.log(
      'Deploying new SimplePoolFactory contract via rest.createContract...'
    );
    const response = await rest.createContract(token, contractArgs, options);

    // Ensure response is an array so that we can safely call .map()
    const responseArray = Array.isArray(response) ? response : [response];

    // 5. Poll until the new contract appears in the database.
    const predicate = (results) =>
      results.filter((r) => r.status === 'Pending').length === 0;
    const action = async (options) =>
      rest.getBlocResults(
        token,
        responseArray.map((r) => r.hash),
        options
      );
    const finalResults = await util.until(
      predicate,
      action,
      { config, isAsync: true },
      3600000
    );
    const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
    if (final.status !== 'Success') {
      throw new Error(`Error: contract deployment failed.`);
    }
    console.log(`New SimplePoolFactory contract deployed.`);
    
    // Store deployment information in a text file
    const deploymentInfo = {
      contractName: contractName,
      deploymentTime: new Date().toISOString(),
      contractAddress: final.contractAddress || final.address,
      transactionHash: final.hash,
      status: final.status
    };
    
    const deploymentDir = path.join(__dirname, '../../../deployment-logs');
    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }
    
    const filename = `${contractName}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const filePath = path.join(deploymentDir, filename);
    
    const content = JSON.stringify(deploymentInfo, null, 2);
    fs.writeFileSync(filePath, content);
    
    console.log(`Deployment information saved to: ${filePath}`);
  } catch (error) {
    console.error('Fatal error in deployment:', error);
  }
}

main();

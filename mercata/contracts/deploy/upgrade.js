/**
 * Upgrade script for BlockApps proxy contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

/**
 * Main upgrade function
 */
async function main() {
  try {
    console.log('Starting proxy upgrade process...');
    console.log('=====================================\n');
    
    // Check for required environment variables
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'PROXY_ADDRESS', 'CONTRACT_NAME', 'CONTRACT_FILE'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
      console.error('\nRequired variables:');
      console.error('  PROXY_ADDRESS - Address of the proxy contract to upgrade');
      console.error('  CONTRACT_NAME - Name of the implementation contract (e.g., PoolFactory)');
      console.error('  CONTRACT_FILE - Filename of the contract (e.g., Pools/PoolFactory.sol)');
      console.error('  GLOBAL_ADMIN_NAME - Admin username');
      console.error('  GLOBAL_ADMIN_PASSWORD - Admin password');
      console.error('\nOptional variables:');
      console.error('  CONSTRUCTOR_ARGS - JSON string of constructor arguments (default: {})');
      console.error('\nExample:');
      console.error('  PROXY_ADDRESS=abc123 CONTRACT_NAME=PoolFactory CONTRACT_FILE=Pools/PoolFactory.sol node upgrade.js');
      process.exit(1);
    }
    
    // Get configuration from environment
    const proxyAddress = process.env.PROXY_ADDRESS;
    const contractName = process.env.CONTRACT_NAME;
    const contractFile = process.env.CONTRACT_FILE;
    const constructorArgs = process.env.CONSTRUCTOR_ARGS ? JSON.parse(process.env.CONSTRUCTOR_ARGS) : {};
    
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    
    console.log(`Proxy Address: ${proxyAddress}`);
    console.log(`Contract Name: ${contractName}`);
    console.log(`Contract File: ${contractFile}`);
    console.log(`Constructor Args: ${JSON.stringify(constructorArgs)}`);
    console.log('');
    
    // Authenticate
    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    console.log(token);
    const tokenObj = { token };
    console.log(`Authenticated as ${username}\n`);
    
    // Step 1: Deploy new implementation
    console.log(`Deploying new implementation: ${contractName}...`);
    
    const contractsDir = config.resolvePath(config.contractsDir);
    const contractFilePath = path.join(contractsDir, contractFile);
    
    if (!fs.existsSync(contractFilePath)) {
      throw new Error(`Contract file not found: ${contractFilePath}`);
    }
    
    console.log(`Contract file: ${contractFilePath}`);
    console.log('Combining contract source files...');
    
    let source = await importer.combine(contractFilePath);
    
    // Strip comments (same logic as deploy.js uses)
    const stripComments = (str) => {
      let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
      out = out.split('\n').map((ln) => {
        const t = ln.trim();
        if (t.startsWith('//')) {
          return t.includes('SPDX-License-Identifier') ? ln : '';
        }
        return ln.replace(/\/\/.*$/, '');
      }).join('\n');
      return out;
    };
    
    if (Buffer.isBuffer(source)) {
      source = stripComments(source.toString());
    } else if (typeof source === 'object') {
      const processed = Object.keys(source).map((k) => {
        let content = source[k];
        content = typeof content === 'string' ? content : String(content);
        content = content.replace(/^.*?\.sol,\s*/i, '');
        return stripComments(content);
      });
      source = processed.join('\n');
    } else if (typeof source === 'string') {
      source = stripComments(source);
    } else {
      source = stripComments(String(source));
    }
    
    console.log('Comments stripped from combined source(s)');

    fs.writeFileSync("contract_source",source);
    
    // Deploy the implementation
    const contractArgs = {
      name: contractName,
      source,
      args: constructorArgs,
      txParams: {
        gasPrice: config.gasPrice,
        gasLimit: config.gasLimit,
      },
    };
    
    const deployOptions = {
      config,
      logger: console,
      history: [contractName],
      cacheNonce: true,
    };
    
    const implementation = await rest.createContract(tokenObj, contractArgs, deployOptions);
    console.log(`Implementation deployed at: ${implementation.address}\n`);
    
    // Step 2: Upgrade the proxy
    console.log(`Upgrading proxy at ${proxyAddress}...`);
    console.log(`New implementation: ${implementation.address}`);
    
    const callArgs = {
      contract: { address: proxyAddress, name: 'Proxy' },
      method: 'setLogicContract',
      args: { _logicContract: implementation.address },
      txParams: {
        gasPrice: config.gasPrice,
        gasLimit: config.gasLimit,
      },
    };
    
    const callOptions = {
      config,
      cacheNonce: true,
    };
    
    const upgradeResult = await rest.call(tokenObj, callArgs, callOptions);

    if (upgradeResult[0]) {
        console.log('\n======  Upgrade  Pending  ======');
        console.log("Proxy Uploaded and Upgrade Requested.")
        console.log("Governance Vote Required.\nVote Issue ID: " + upgradeResult[0]);
    }
    else {
        console.log('\n====== Upgrade Successful ======');
    }

    console.log(`Proxy Address: ${proxyAddress}`);
    console.log(`New Implementation: ${implementation.address}`);
    console.log('================================\n');
    
    // Save upgrade information
    const upgradeInfo = {
      proxyAddress,
      newImplementation: implementation.address,
      contractName,
      contractFile,
      upgradeTime: new Date().toISOString(),
    };
    
    return upgradeInfo;
  } catch (error) {
    console.error('\nUpgrade failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = main;

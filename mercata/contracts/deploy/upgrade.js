/**
 * Upgrade script for BlockApps proxy contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');

// The owner of the implementation address is ignored in favor of the proxy owner
const DEFAULT_CONSTRUCTOR_ARGS = {"initialOwner": "deadbeef"};

/**
 * Print usage information
 */
function printUsage() {
  console.error('Usage: node upgrade.js [options]');
  console.error('');
  console.error('Required arguments:');
  console.error('  --proxy-address <addresses>  Address(es) of the proxy contract(s) to upgrade');
  console.error('                               Can be a single address or comma-separated list');
  console.error('  --contract-name <name>       Name of the implementation contract (e.g., PoolFactory)');
  console.error('  --contract-file <file>       Filename of the contract (e.g., Pools/PoolFactory.sol)');
  console.error('');
  console.error('Optional arguments:');
  console.error('  --constructor-args <json>    JSON string of constructor arguments (default: ' + JSON.stringify(DEFAULT_CONSTRUCTOR_ARGS) + ')');
  console.error('  +OVERRIDE-CHECKS             Override the contract name check');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('');
  console.error('Example:');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name PoolFactory --contract-file Pools/PoolFactory.sol');
  console.error('  node upgrade.js --proxy-address abc123,def456,ghi789 --contract-name PoolFactory --contract-file Pools/PoolFactory.sol');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name LendingPool --contract-file Lending/LendingPool.sol --constructor-args \'{"param":"value"}\'');
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for argument: ${arg}`);
      }
      parsed[key] = value;
      i++; // Skip the value in next iteration
    }
    if (arg.startsWith('+')) {
        // e.g. +OVERRIDE-CHECKS
        const key = arg.slice(1);
        parsed[key] = true;
    }
  }
  
  return parsed;
}

/** Get the logic contract address from a proxy (read-only)
 *  Also used to verify that the address is actually a Proxy
 */
async function getLogicContract(tokenObj, proxyAddress) {
    const contract = { address: proxyAddress, name: 'Proxy' };
    const options = { config };
    
    let implementationAddress = null;
    try {
        const state = await rest.getState(tokenObj, contract, options);
        implementationAddress = state.logicContract;
    } catch (error) {
        console.error(error.message);
    }
    if (!implementationAddress) {
        throw new Error('Could not retrieve logicContract address from Proxy.\nIs this address actually a Proxy?');
    }
    return implementationAddress;
}

/** Verify that the proxy exists and has the expected implementation contract name
 */
async function verifyProxyAndImplementation(tokenObj, proxyAddress, contractName) {
    // @dev blockapps-rest is deprecated and results in false positives in the checker,
    // so we skip the verification for now
    console.log('Skipping proxy and contract name verification...');
    return;

    console.log('Verifying proxy and implementation...');
    
    // Try to get the logic contract address (this will fail if not a proxy)
    const implementationAddress = await getLogicContract(tokenObj, proxyAddress);
    console.log(`Old implementation address: ${implementationAddress}`);
    
    // Verify the current implementation contract name using Cirrus search
    console.log(`Verifying implementation contract name '${contractName}'...`);
    const searchOptions = {
        config,
        query: {
            address: `eq.${implementationAddress}`
        }
    };
    
    try {
        const results = await rest.search(tokenObj, { name: contractName }, searchOptions);
        
        if (!results || results.length === 0) {
            throw new Error(`The previous implementation does not seem to match the new contract name '${contractName}'.\nAre you sure you want to upgrade to a different contract type?`);
            // @dev if yes, then set +OVERRIDE-CHECKS flag
        }
        
        console.log(`Implementation contract name '${contractName}' verified`);
    } catch (error) {
        if (error.message.includes('No contract named')) {
            throw new Error(`The previous implementation does not seem to match the new contract name '${contractName}'.\nAre you sure you want to upgrade to a different contract type?`);
        }
        else {
            throw error;
        }

    }
}

/**
 * Main upgrade function
 */
async function main() {
  try {
    console.log('Starting proxy upgrade process...');
    console.log('=====================================\n');
    
    // Parse command-line arguments
    let args;
    try {
      args = parseArgs();
    } catch (error) {
      console.error(`Error parsing arguments: ${error.message}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Check for required arguments
    const requiredArgs = ['proxy-address', 'contract-name', 'contract-file'];
    const missingArgs = requiredArgs.filter(arg => !args[arg]);
    
    if (missingArgs.length > 0) {
      console.error(`Missing required arguments: ${missingArgs.map(a => '--' + a).join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Check for required environment variables
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_URL', 'NODE_URL'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Get configuration from command-line arguments
    const proxyAddressesStr = args['proxy-address'];
    const proxyAddresses = proxyAddressesStr.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    const contractName = args['contract-name'];
    const contractFile = args['contract-file'];
    const constructorArgs = args['constructor-args'] ? JSON.parse(args['constructor-args']) : DEFAULT_CONSTRUCTOR_ARGS;
    
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    
    console.log(`Proxy Addresses (${proxyAddresses.length}): ${proxyAddresses.join(', ')}`);
    console.log(`Contract Name: ${contractName}`);
    console.log(`Contract File: ${contractFile}`);
    console.log(`Constructor Args: ${JSON.stringify(constructorArgs)}`);
    console.log('');
    
    // Authenticate
    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log(`Authenticated as ${username}\n`);

    // Verify that each proxy exists and the implementation contract name matches the new contract name
    if (!args['OVERRIDE-CHECKS']) {
      for (const proxyAddress of proxyAddresses) {
        await verifyProxyAndImplementation(tokenObj, proxyAddress, contractName);
      }
    }
    
    // Step 1: Deploy new implementation
    console.log(`Deploying new implementation: ${contractName}`);
    
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
    
    // Step 2: Upgrade all proxies to point to the same implementation
    const upgradeResults = [];
    const callOptions = {
      config,
      cacheNonce: true,
    };
    
    for (let i = 0; i < proxyAddresses.length; i++) {
      const proxyAddress = proxyAddresses[i];
      console.log(`\nUpgrading proxy ${i + 1}/${proxyAddresses.length} at ${proxyAddress}...`);
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
      
      const upgradeResult = await rest.call(tokenObj, callArgs, callOptions);
      upgradeResults.push({ proxyAddress, upgradeResult });

      if (upgradeResult[0]) {
        console.log(`Proxy ${proxyAddress}: Upgrade Pending - Governance Vote Required (Issue ID: ${upgradeResult[0]})`);
      } else {
        console.log(`Proxy ${proxyAddress}: Upgrade Successful`);
      }
    }

    console.log('\n====== Upgrade Summary ======');
    const pendingUpgrades = upgradeResults.filter(r => r.upgradeResult[0]);
    const successfulUpgrades = upgradeResults.filter(r => !r.upgradeResult[0]);
    
    if (successfulUpgrades.length > 0) {
      console.log(`\nSuccessfully upgraded ${successfulUpgrades.length} proxy(ies):`);
      successfulUpgrades.forEach(r => console.log(`  - ${r.proxyAddress}`));
    }
    
    if (pendingUpgrades.length > 0) {
      console.log(`\n${pendingUpgrades.length} upgrade(s) pending governance vote:`);
      pendingUpgrades.forEach(r => console.log(`  - ${r.proxyAddress} (Issue ID: ${r.upgradeResult[0]})`));
    }
    
    console.log(`\nNew Implementation: ${implementation.address}`);
    console.log('================================\n');
    
    // Save upgrade information
    const upgradeInfo = {
      proxyAddresses,
      newImplementation: implementation.address,
      contractName,
      contractFile,
      upgradeTime: new Date().toISOString(),
      results: upgradeResults.map(r => ({
        proxyAddress: r.proxyAddress,
        voteIssueId: r.upgradeResult[0] || null,
        success: !r.upgradeResult[0],
      })),
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

/**
 * Upgrade script for BlockApps proxy contracts
 */
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest, importer } = require('blockapps-rest');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

// The owner of the implementation address is ignored in favor of the proxy owner
const DEFAULT_CONSTRUCTOR_ARGS = {"initialOwner": "deadbeef"};

/**
 * Print usage information
 */
function printUsage() {
  console.error('Usage: node upgrade.js [options]');
  console.error(' OR    npm run upgrade -- [options]');
  console.error('');
  console.error('Required arguments:');
  console.error('  --proxy-address <address>    Address of the proxy contract to upgrade');
  console.error('  --contract-name <name>       Name of the implementation contract (e.g., PoolFactory)');
  console.error('  --contract-file <file>       Filename of the contract (e.g., Pools/PoolFactory.sol)');
  console.error('');
  console.error('Optional arguments:');
  console.error('  --constructor-args <json>    JSON string of constructor arguments (default: ' + JSON.stringify(DEFAULT_CONSTRUCTOR_ARGS) + ')');
  console.error('  +OVERRIDE-CHECKS             Override the contract name check');
  console.error('');
  console.error('Required environment variables (.env):');
  console.error('  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_DISCOVERY_URL, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD');
  console.error('');
  console.error('Example:');
  console.error('  node upgrade.js --proxy-address abc123 --contract-name PoolFactory --contract-file Pools/PoolFactory.sol');
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
    // @dustin: if you have all the addresses, you can query the storage table
    console.log(`Getting logic contract for proxy ${proxyAddress}`);
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
    console.log(`Logic contract for proxy ${proxyAddress}: ${implementationAddress}`);
    return implementationAddress;
}

/** Verify that the proxy exists and has the expected implementation contract name
 */
async function verifyProxyAndImplementation(tokenObj, proxyAddress, contractName) {
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
 * Looks up all instances of proxies that point to a logicContract named according to the supplied query.
 * @param {Object} tokenObj - Authentication token object
 * @param {string} contractName - The name of the contract for which to search
 * @return {Promise<string[]>} A list of addresses, each of which is the address of a proxy whose logicContract is a <`contractName`>
 */
async function getInstancesOfContractProxied(tokenObj, contractName) {
    // Find all proxy addresses whose logicContract points to an implementation of contractName
    // Uses BLOC API to get all Proxy contracts (including genesis), then filters by implementation
    
    const nodeUrl = config.nodes[0].url;
    const token = tokenObj.token;
    const options = { config };
    
    // 1. Get ALL Proxy contracts using BLOC API (includes genesis contracts)
    // The BLOC API endpoint is at /bloc/v2.2/contracts
    let allProxyAddresses = [];
    try {
        const contractsUrl = `${nodeUrl}/bloc/v2.2/contracts?name=Proxy`;
        const response = await axios.get(contractsUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });
        
        // Response should be an object with contract names as keys
        if (response.data && response.data.Proxy) {
            allProxyAddresses = response.data.Proxy.map(p => p.address);
            console.log(`Found ${allProxyAddresses.length} Proxy contracts from BLOC API`);
        }
    } catch (err) {
        console.log(`BLOC API error: ${err.message}`);
        return [];
    }
    
    if (allProxyAddresses.length === 0) {
        console.log('No Proxy contracts found');
        return [];
    }
    
    console.log(`Checking ${allProxyAddresses.length} proxies for ${contractName} implementations`);
    
    // 2. For each proxy, verify it points to the target contract type
    const results = [];
    
    for (const proxyAddress of allProxyAddresses) {
        try {
            // Get the logic contract address from the proxy
            const logicContractAddress = await getLogicContract(tokenObj, proxyAddress);
            
            // Get the implementation contract details to check the name
            const contractDetails = await rest.getContractsDetails(
                tokenObj,
                { address: logicContractAddress },
                options
            );
            
            if (contractDetails && contractDetails._contractName === contractName) {
                console.log(`✓ ${proxyAddress} -> ${contractName} at ${logicContractAddress}`);
                results.push(proxyAddress);
            }
        } catch (e) {
            // Handle specific case: implementation address doesn't exist or isn't deployed
            if (e.response && e.response.status === 400 && e.response.data && 
                typeof e.response.data === 'string' && 
                e.response.data.includes("couldn't find contract details")) {
                // This is expected for proxies pointing to non-existent implementations
                continue;
            }
            // For other errors, also skip silently
            continue;
        }
    }
    
    return results;
}

/**
 * Looks up the current contract code of the logicContract of the proxy at the requested `proxyAddress`.
 * @param tokenObj Authentication token object
 * @param proxyAddress The proxy whose implementation code will be fetched
 * @returns A string of the implementation smart contract source code
 */
async function getCurrentImplementationCode(tokenObj, proxyAddress) {
  // Get the implementation address from the proxy
  const implementationAddress = await getLogicContract(tokenObj, proxyAddress);
  
  const nodeUrl = config.nodes[0].url;
  const token = tokenObj.token;
  
  try {
    console.log(`Retrieving code for implementation at ${implementationAddress}`);
    
    // Step 1: Get the account info to retrieve the code hash
    const accountUrl = `${nodeUrl}/strato-api/eth/v1.2/account?address=${implementationAddress}`;
    const accountResponse = await axios.get(accountUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    const accountData = accountResponse.data[0];
    console.log('Account data received:', accountData ? Object.keys(accountData) : 'null');
    
    if (!accountData || !accountData.codeHash) {
      console.warn('No codeHash found in account data');
      return null;
    }
    
    const codeHash = accountData.codeHash;
    console.log(`Code hash: ${codeHash}`);
    
    // Step 2: Get the actual source code using the code hash
    const codeUrl = `${nodeUrl}/strato-api/eth/v1.2/code/${codeHash}`;
    const codeResponse = await axios.get(codeUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    let sourceCode;
    if (typeof codeResponse.data === 'object') {
      sourceCode = codeResponse.data.reduce((acc, item) => acc + item[1], '');
    }
    else if (typeof codeResponse.data === 'string') {
      sourceCode = codeResponse.data;
    }
    else {
      throw new Error('Unexpected code response type', typeof codeResponse.data);
    }
    if (!sourceCode || sourceCode.length === 0) {
      console.warn('No source code found in code data');
      return null;
    }
    
    return sourceCode;
  } catch (error) {
    console.error('Error retrieving source code:', error.message);
    return null;
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

    // Use new mode if requested
    if (args['new-mode']) {
      // Authenticate once for all tests
      const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
      const tokenObj = { token };
      
      // test getCurrentImplementationCode
      if (args['proxy-address']) {
        const sourceCode = await getCurrentImplementationCode(
          tokenObj,
          args['proxy-address']
        );
        if (sourceCode) {
          console.log('Source code retrieved successfully!');
          console.log('Source length:', sourceCode.length, 'characters');
          console.log('Source code:', typeof(sourceCode), Object.keys(sourceCode));
          console.log('First 200 chars:', sourceCode.substring(0, 200));
        } else {
          console.log('Source code not available (this is OK - upgrade can proceed without it)');
        }
      }

      // Test getInstancesOfContractProxied
      if (args['contract-name']) {
        const instances = await getInstancesOfContractProxied(
          tokenObj,
          args['contract-name']
        );
        console.log(`\nFound ${instances.length} proxies with ${args['contract-name']} implementation:`);
        console.log(instances);
      }

      process.exit(0);
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
    const requiredVars = ['GLOBAL_ADMIN_NAME', 'GLOBAL_ADMIN_PASSWORD', 'OAUTH_CLIENT_SECRET', 'OAUTH_CLIENT_ID', 'OAUTH_DISCOVERY_URL', 'OAUTH_URL', 'NODE_URL'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(', ')}\n`);
      printUsage();
      process.exit(1);
    }
    
    // Get configuration from command-line arguments
    const proxyAddress = args['proxy-address'];
    const contractName = args['contract-name'];
    const contractFile = args['contract-file'];
    const constructorArgs = args['constructor-args'] ? JSON.parse(args['constructor-args']) : DEFAULT_CONSTRUCTOR_ARGS;
    
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
    const tokenObj = { token };
    console.log(`Authenticated as ${username}\n`);

    // Verify that the proxy exists and the implementation contract name matches the new contract name
    args['OVERRIDE-CHECKS'] || await verifyProxyAndImplementation(tokenObj, proxyAddress, contractName);
    
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


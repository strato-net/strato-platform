const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Modular deployment script for UUPS upgradeable contracts
 * 
 * Usage examples:
 * 
 * 1. Deploy DepositRouter:
 *    CONTRACT_NAME=DepositRouter INIT_PARAMS='["0x8713850E9fF0fd0200ce87C32E3cdB24eD021631", "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631"]' npx hardhat run scripts/deployWithProxy.js --network sepolia
 *    
 * 2. Deploy any contract with parameters:
 *    CONTRACT_NAME=MyToken INIT_PARAMS='["MyToken", "MTK", 1000000]' npx hardhat run scripts/deployWithProxy.js --network sepolia
 * 
 * 3. Deploy with auto-verification on Etherscan:
 *    CONTRACT_NAME=MyContract INIT_PARAMS='["param1", "param2"]' AUTO_VERIFY=true npx hardhat run scripts/deployWithProxy.js --network sepolia
 * 
 * Required environment variables:
 * - CONTRACT_NAME: Name of the contract to deploy
 * - INIT_PARAMS: JSON array of initialization parameters
 * 
 * Optional environment variables:
 * - INIT_METHOD: Initializer function name (default: "initialize")
 * - PROXY_KIND: Type of proxy (default: "uups")
 * - SKIP_VERIFICATION: Skip post-deployment checks (default: false)
 * - AUTO_VERIFY: Auto-verify on Etherscan after deployment (default: false)
 * - SAVE_DEPLOYMENT: Save deployment info to file (default: true)
 */

/**
 * Load configuration from environment variables
 */
async function loadConfig() {
  // Required parameters
  if (!process.env.CONTRACT_NAME) {
    console.error("❌ ERROR: CONTRACT_NAME environment variable is required");
    console.error("\nUsage example:");
    console.error('  CONTRACT_NAME=MyContract INIT_PARAMS=\'["param1", "param2"]\' npx hardhat run scripts/deployWithProxy.js --network sepolia');
    process.exit(1);
  }

  if (!process.env.INIT_PARAMS) {
    console.error("❌ ERROR: INIT_PARAMS environment variable is required");
    console.error("\nUsage example:");
    console.error('  CONTRACT_NAME=MyContract INIT_PARAMS=\'["param1", "param2"]\' npx hardhat run scripts/deployWithProxy.js --network sepolia');
    process.exit(1);
  }

  let initParams;
  try {
    initParams = JSON.parse(process.env.INIT_PARAMS);
    if (!Array.isArray(initParams)) {
      throw new Error("INIT_PARAMS must be an array");
    }
  } catch (error) {
    console.error("❌ ERROR: Invalid INIT_PARAMS format. Must be a valid JSON array.");
    console.error("  Example: '[\"0x123...\", 100, true]'");
    console.error("  Error:", error.message);
    process.exit(1);
  }

  const config = {
    contractName: process.env.CONTRACT_NAME,
    initParams: initParams,
    initMethod: process.env.INIT_METHOD || "initialize",
    proxyKind: process.env.PROXY_KIND || "uups",
    skipVerification: process.env.SKIP_VERIFICATION === 'true',
    saveDeployment: process.env.SAVE_DEPLOYMENT !== 'false' // Default true
  };

  return config;
}

/**
 * Save deployment information to a JSON file
 */
async function saveDeploymentInfo(contractName, network, deploymentInfo) {
  const deploymentsDir = path.resolve('deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${contractName}_${network}_${timestamp}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\nDeployment info saved to: ${filepath}`);

  // Also save/update the latest deployment
  const latestFilepath = path.join(deploymentsDir, `${contractName}_${network}_latest.json`);
  fs.writeFileSync(latestFilepath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Latest deployment info saved to: ${latestFilepath}`);
}

/**
 * Check deployment by calling getter functions
 */
async function checkDeployment(contract, contractName) {
  try {
    console.log("\nChecking deployment by calling getter functions...");
    
    // Try to call common getter functions
    const commonGetters = ['owner', 'version', 'paused', 'symbol', 'name', 'totalSupply'];
    const deploymentChecks = {};

    for (const getter of commonGetters) {
      try {
        if (contract[getter]) {
          const result = await contract[getter]();
          deploymentChecks[getter] = result.toString();
          console.log(`  ${getter}:`, result.toString());
        }
      } catch {
        // Getter doesn't exist or failed, skip
      }
    }

    // Contract-specific checks
    if (contractName === "DepositRouter") {
      try {
        const gnosisSafe = await contract.getGnosisSafe();
        console.log("  Gnosis Safe:", gnosisSafe);
        deploymentChecks.gnosisSafe = gnosisSafe;
      } catch {}
    }

    return deploymentChecks;
  } catch (error) {
    console.log("Deployment check skipped or failed:", error.message);
    return {};
  }
}

/**
 * Verify contracts on Etherscan (both proxy and implementation)
 */
async function verifyOnEtherscan(proxyAddress, implementationAddress, networkName) {
  let proxyVerified = false;
  let implementationVerified = false;

  // Verify implementation contract (this is the important one)
  try {
    console.log("\nVerifying implementation contract on Etherscan...");
    await hre.run("verify:verify", {
      address: implementationAddress,
    });
    console.log("✅ Implementation contract verified on Etherscan!");
    implementationVerified = true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Implementation contract already verified on Etherscan");
      implementationVerified = true;
    } else {
      console.log("⚠️  Implementation verification failed:", error.message);
      console.log("   You can verify manually with:");
      console.log(`   npx hardhat verify --network ${networkName} ${implementationAddress}`);
    }
  }

  // Verify proxy contract (usually already verified if using OpenZeppelin)
  try {
    console.log("\nVerifying proxy contract on Etherscan...");
    await hre.run("verify:verify", {
      address: proxyAddress,
    });
    console.log("✅ Proxy contract verified on Etherscan!");
    proxyVerified = true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Proxy contract already verified on Etherscan");
      proxyVerified = true;
    } else {
      console.log("⚠️  Proxy verification failed:", error.message);
      console.log("   Note: Proxy contracts are often already verified by OpenZeppelin");
    }
  }

  return { proxyVerified, implementationVerified };
}

/**
 * Main deployment function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("MODULAR PROXY DEPLOYMENT SCRIPT");
  console.log("=".repeat(60));

  // Load configuration from environment variables
  const config = await loadConfig();
  console.log("\nDeployment Configuration:");
  console.log("  Contract Name:", config.contractName);
  console.log("  Initialization Method:", config.initMethod);
  console.log("  Proxy Kind:", config.proxyKind);
  console.log("  Initialization Parameters:", JSON.stringify(config.initParams, null, 2));
  console.log("  Skip Deployment Check:", config.skipVerification);
  console.log("  Auto-verify on Etherscan:", process.env.AUTO_VERIFY === 'true');
  console.log("  Save Deployment:", config.saveDeployment);

  // Get network information
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  console.log("\nNetwork Information:");
  console.log("  Network:", networkName);
  console.log("  Chain ID:", network.chainId);

  // Get deployer information
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);
  console.log("\nDeployer Information:");
  console.log("  Address:", deployer.address);
  console.log("  Balance:", ethers.formatEther(balance), "ETH");

  // Check if balance is sufficient
  if (balance === 0n) {
    throw new Error("Deployer has no ETH balance. Cannot deploy.");
  }

  // Get contract factory
  console.log(`\nLoading contract factory for ${config.contractName}...`);
  let ContractFactory;
  try {
    ContractFactory = await ethers.getContractFactory(config.contractName);
  } catch (error) {
    console.error(`Failed to load contract ${config.contractName}:`, error.message);
    console.error("Make sure the contract is compiled and the name is correct.");
    process.exit(1);
  }

  // Deploy proxy and implementation
  console.log("\nDeploying proxy and implementation...");
  console.log("This may take a few moments...");
  
  let proxy;
  const deploymentStartTime = Date.now();
  
  try {
    proxy = await upgrades.deployProxy(
      ContractFactory,
      config.initParams,
      {
        initializer: config.initMethod,
        kind: config.proxyKind,
        timeout: 0, // No timeout
        pollingInterval: 5000, // Check every 5 seconds
      }
    );

    console.log("Waiting for deployment confirmation...");
    await proxy.waitForDeployment();
  } catch (error) {
    console.error("\nDeployment failed:", error.message);
    if (error.message.includes("constructor")) {
      console.error("Note: The contract might have a constructor. Upgradeable contracts should not have constructors.");
    }
    process.exit(1);
  }

  const deploymentTime = (Date.now() - deploymentStartTime) / 1000;
  console.log(`Deployment completed in ${deploymentTime.toFixed(1)} seconds`);

  // Get addresses
  const proxyAddress = await proxy.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT SUCCESSFUL!");
  console.log("=".repeat(60));
  console.log("\nContract Addresses:");
  console.log("  Proxy:", proxyAddress);
  console.log("  Implementation:", implementationAddress);
  console.log("  ProxyAdmin:", adminAddress);

  // Perform deployment checks
  let deploymentChecks = {};
  if (!config.skipVerification) {
    deploymentChecks = await checkDeployment(proxy, config.contractName);
  }

  // Auto-verify on Etherscan if requested
  let etherscanVerified = { proxyVerified: false, implementationVerified: false };
  if (process.env.AUTO_VERIFY === 'true') {
    etherscanVerified = await verifyOnEtherscan(proxyAddress, implementationAddress, networkName);
  }

  // Prepare deployment information
  const deploymentInfo = {
    contractName: config.contractName,
    network: {
      name: networkName,
      chainId: network.chainId.toString()
    },
    addresses: {
      proxy: proxyAddress,
      implementation: implementationAddress,
      proxyAdmin: adminAddress
    },
    deployer: deployer.address,
    deploymentTime: new Date().toISOString(),
    deploymentBlock: await ethers.provider.getBlockNumber(),
    configuration: {
      initMethod: config.initMethod,
      initParams: config.initParams,
      proxyKind: config.proxyKind
    },
    deploymentChecks: deploymentChecks,
    etherscanVerified: etherscanVerified,
    gasUsed: "N/A" // Would need to track this from deployment transaction
  };

  // Save deployment information
  if (config.saveDeployment) {
    await saveDeploymentInfo(config.contractName, networkName, deploymentInfo);
  }

  // Print next steps
  console.log("\n" + "=".repeat(60));
  console.log("NEXT STEPS:");
  console.log("=".repeat(60));
  console.log("\n1. Save the proxy address for interacting with the contract:");
  console.log(`   ${proxyAddress}`);
  
  if (!etherscanVerified.implementationVerified) {
    console.log("\n2. Verify implementation on Etherscan manually:");
    console.log(`   npx hardhat verify --network ${networkName} ${implementationAddress}`);
  } else {
    console.log("\n2. ✅ Implementation contract already verified on Etherscan!");
  }
  
  if (!etherscanVerified.proxyVerified) {
    console.log("\n3. Verify proxy on Etherscan manually (if needed):");
    console.log(`   npx hardhat verify --network ${networkName} ${proxyAddress}`);
  }
  
  if (config.contractName === "DepositRouter") {
    console.log("\n4. Configure the DepositRouter:");
    console.log("   - Use setTokenAllowed() to enable tokens");
    console.log("   - Use setMinDepositAmount() to set minimum amounts");
    console.log("   - Use batchUpdateTokens() for bulk configuration");
  }

  if (config.saveDeployment) {
    console.log("\n5. Check the deployment info in:");
    console.log(`   deployments/${config.contractName}_${networkName}_latest.json`);
  }

  return deploymentInfo;
}

// Execute deployment
main()
  .then((deploymentInfo) => {
    console.log("\n✅ Deployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed!");
    console.error(error);
    process.exit(1);
  });
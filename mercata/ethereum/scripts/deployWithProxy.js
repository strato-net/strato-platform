const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");


/**
 * Load configuration from environment variables
 */

async function loadConfig() {
  // Required parameters
  if (!process.env.CONTRACT_NAME) {
    console.error(" ERROR: CONTRACT_NAME environment variable is required");
    console.error("\nUsage example:");
    console.error('  CONTRACT_NAME=MyContract INIT_PARAMS=\'["param1", "param2"]\' npx hardhat run scripts/deployWithProxy.js --network sepolia');
    process.exit(1);
  }

  if (!process.env.INIT_PARAMS) {
    console.error(" ERROR: INIT_PARAMS environment variable is required");
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
    console.error(" ERROR: Invalid INIT_PARAMS format. Must be a valid JSON array.");
    console.error("  Example: '[\"0x123...\", 100, true]'");
    console.error("  Error:", error.message);
    process.exit(1);
  }

  const config = {
    contractName: process.env.CONTRACT_NAME,
    initParams: initParams,
    initMethod: process.env.INIT_METHOD || "initialize",
    proxyKind: process.env.PROXY_KIND || "uups",
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
 * Main deployment function
 */
async function main() {
  console.log("=".repeat(60));
  console.log("PROXY DEPLOYMENT SCRIPT");
  console.log("=".repeat(60));

  // Load configuration from environment variables
  const config = await loadConfig();
  console.log("\nDeployment Configuration:");
  console.log("  Contract Name:", config.contractName);
  console.log("  Initialization Method:", config.initMethod);
  console.log("  Proxy Kind:", config.proxyKind);
  console.log("  Initialization Parameters:", JSON.stringify(config.initParams, null, 2));

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
        kind: config.proxyKind
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
    gasUsed: "N/A" // Would need to track this from deployment transaction
  };

  // Save deployment information
  await saveDeploymentInfo(config.contractName, networkName, deploymentInfo);

  
  console.log("To Verify on Etherscan:");
  console.log(`   npm run verify:${networkName} -- ${implementationAddress}`);
  
  console.log("Check the deployment info in:");
  console.log(`   deployments/${config.contractName}_${networkName}_latest.json`);

  return deploymentInfo;
}

// Execute deployment
main()
  .then((deploymentInfo) => {
    console.log("\n Deployment completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n Deployment failed!");
    console.error(error);
    process.exit(1);
  });
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const contractName = process.env.CONTRACT_NAME || "DepositRouter";
  const network = await ethers.provider.getNetwork();
  const networkName = network.name || "unknown";
  const [deployer] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("IMPLEMENTATION-ONLY DEPLOYMENT");
  console.log("=".repeat(60));
  console.log("Contract:", contractName);
  console.log("Network:", networkName, `(${network.chainId})`);
  console.log("Deployer:", deployer.address);

  const factory = await ethers.getContractFactory(contractName);
  const implementation = await factory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  console.log("\nDeployment successful");
  console.log("Implementation:", implementationAddress);

  const deploymentsDir = path.resolve("deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const payload = {
    contractName,
    network: {
      name: networkName,
      chainId: network.chainId.toString(),
    },
    deployer: deployer.address,
    implementation: implementationAddress,
    deployedAt: new Date().toISOString(),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(
    deploymentsDir,
    `${contractName}_${networkName}_implementation_${timestamp}.json`,
  );
  const latestPath = path.join(
    deploymentsDir,
    `${contractName}_${networkName}_implementation_latest.json`,
  );

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  console.log("Saved:", outPath);
  console.log("Saved:", latestPath);
}

main().catch((error) => {
  console.error("Implementation deployment failed:", error.message);
  process.exit(1);
});


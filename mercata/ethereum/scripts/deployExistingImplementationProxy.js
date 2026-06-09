const fs = require("fs");
const path = require("path");
const { Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, getCreateAddress, isAddress } = require("ethers");
require("dotenv").config();

const proxyArtifact = require("../node_modules/@openzeppelin/upgrades-core/artifacts/@openzeppelin/contracts-v5/proxy/ERC1967/ERC1967Proxy.sol/ERC1967Proxy.json");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseInitParams() {
  const raw = requireEnv("INIT_PARAMS");
  const params = JSON.parse(raw);
  if (!Array.isArray(params)) {
    throw new Error("INIT_PARAMS must be a JSON array");
  }
  return params;
}

function findArtifact(contractName) {
  const root = path.resolve("artifacts/contracts");
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name === `${contractName}.json`) {
        return require(entryPath);
      }
    }
  }

  throw new Error(`Artifact not found for ${contractName}. Run npx hardhat compile first.`);
}

function hasNoArgFunction(artifact, name) {
  return artifact.abi.some((item) => (
    item.type === "function" &&
    item.name === name &&
    item.inputs.length === 0
  ));
}

async function main() {
  const contractName = process.env.CONTRACT_NAME || "StratoNativeRepresentationToken";
  const rpcUrl = requireEnv("MAINNET_RPC_URL");
  const privateKey = requireEnv("PRIVATE_KEY");
  const implementation = requireEnv("IMPLEMENTATION_ADDRESS");
  const initMethod = process.env.INIT_METHOD || "initialize";
  const initParams = parseInitParams();
  const contractArtifact = findArtifact(contractName);

  if (!isAddress(implementation)) {
    throw new Error("IMPLEMENTATION_ADDRESS must be a valid address");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== 1n) {
    throw new Error(`Expected Ethereum mainnet chainId 1, got ${network.chainId}`);
  }

  const implementationCode = await provider.getCode(implementation);
  if (implementationCode === "0x") {
    throw new Error(`No code found at IMPLEMENTATION_ADDRESS ${implementation}`);
  }

  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const predictedProxy = getCreateAddress({ from: wallet.address, nonce });
  const initData = new Interface(contractArtifact.abi).encodeFunctionData(initMethod, initParams);

  console.log("=".repeat(60));
  console.log("EXISTING IMPLEMENTATION PROXY DEPLOYMENT");
  console.log("=".repeat(60));
  console.log("Contract:", contractName);
  console.log("Network:", network.name, `(${network.chainId})`);
  console.log("Deployer:", wallet.address);
  console.log("Nonce:", nonce);
  console.log("Implementation:", implementation);
  console.log("Predicted proxy:", predictedProxy);
  console.log("Initializer:", initMethod);
  console.log("INIT_PARAMS:", JSON.stringify(initParams));

  if (process.env.CONFIRM_MAINNET_DEPLOY !== "1") {
    console.log("\nDry run only. Set CONFIRM_MAINNET_DEPLOY=1 to broadcast.");
    console.log("Initializer calldata:", initData);
    return;
  }

  const factory = new ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, wallet);
  const proxy = await factory.deploy(implementation, initData);
  const tx = proxy.deploymentTransaction();
  console.log("\nBroadcast:", tx.hash);

  const receipt = await tx.wait(1);
  if (receipt.status !== 1) {
    throw new Error(`Proxy deployment reverted: ${tx.hash}`);
  }

  const proxyAddress = await proxy.getAddress();
  const contract = new Contract(proxyAddress, contractArtifact.abi, provider);

  const payload = {
    contractName,
    network: {
      name: "mainnet",
      chainId: network.chainId.toString(),
    },
    addresses: {
      proxy: proxyAddress,
      implementation,
    },
    deployer: wallet.address,
    deploymentTime: new Date().toISOString(),
    deploymentBlock: receipt.blockNumber,
    configuration: {
      initMethod,
      initParams,
      proxyKind: "uups",
    },
    transactionHash: tx.hash,
  };

  const deploymentsDir = path.resolve("deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(deploymentsDir, `${contractName}_mainnet_${timestamp}.json`);
  const latestPath = path.join(deploymentsDir, `${contractName}_mainnet_latest.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));

  console.log("\nDeployment successful");
  console.log("Proxy:", proxyAddress);
  console.log("Implementation:", implementation);
  if (hasNoArgFunction(contractArtifact, "name")) {
    console.log("Name:", await contract.name());
  }
  if (hasNoArgFunction(contractArtifact, "symbol")) {
    console.log("Symbol:", await contract.symbol());
  }
  if (hasNoArgFunction(contractArtifact, "version")) {
    console.log("Version:", await contract.version());
  }
  console.log("Saved:", outPath);
  console.log("Saved:", latestPath);
}

main().catch((error) => {
  console.error("Proxy deployment failed:", error.message);
  process.exit(1);
});

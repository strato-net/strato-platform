const { ethers } = require("hardhat");


async function checkContractState() {
  // Get contract address from environment variable
  const contractAddress = process.env.DEPOSIT_ROUTER_ADDRESS;
  if (!contractAddress) {
    console.error("DEPOSIT_ROUTER_ADDRESS environment variable is required");
    process.exit(1);
  }
  
  const contractABI = require("../artifacts/contracts/bridge/DepositRouter.sol/DepositRouter.json").abi;

  console.log(`Contract address: ${contractAddress}`);
  console.log(`Network: ${await ethers.provider.getNetwork().then(n => n.name)}`);

  // Get the contract instance
  const YourContract = await ethers.getContractAt(contractABI, contractAddress);

  // First, let's test if the contract is responding at all
  try {
    const code = await ethers.provider.getCode(contractAddress);
    console.log(`Contract code length: ${code.length} bytes`);
    if (code === "0x") {
      console.error("No contract found at this address!");
      return;
    }
  } catch (error) {
    console.error("Error checking contract code:", error.message);
    return;
  }

  // Get all tokens that have been configured by querying events
  console.log("Querying all configured tokens from TokenConfigUpdated events...");
  
  try {
    const filter = YourContract.filters.TokenConfigUpdated();
    const events = await YourContract.queryFilter(filter, 0, 'latest');
    
    // Get unique token addresses from events
    const configuredTokens = new Set();
    for (const event of events) {
      configuredTokens.add(event.args.token);
    }
    
    console.log(`Found ${configuredTokens.size} unique configured tokens\n`);
    
    // Check each configured token and get its symbol
    for (const tokenAddress of configuredTokens) {
      try {
        // Get current token config from contract
        const currentConfig = await YourContract.tokenConfig(tokenAddress);
        
        // Try to get token symbol (standard ERC20)
        let symbol = "Unknown";
        try {
          const tokenContract = await ethers.getContractAt("IERC20Metadata", tokenAddress);
          symbol = await tokenContract.symbol();
        } catch (symbolError) {
          // If symbol() fails, use address as fallback
          symbol = tokenAddress.slice(0, 8) + "...";
        }
        
        console.log(`${symbol} (${tokenAddress}):`);
        console.log(`  Min: ${currentConfig.min}`);
        console.log(`  Permissions: ${currentConfig.permissions}`);
        console.log("");
      } catch (error) {
        console.error(`Error checking configured token ${tokenAddress}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error("Error querying events:", error.message);
  }
}

checkContractState().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

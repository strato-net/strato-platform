/**
 * Read-only verification of the bridge configuration on testnet.
 *
 * Checks per chain (sepolia, baseSepolia):
 *   1. DepositRouter proxy implementation + owner
 *   2. ExternalBridgeVault proxy version + BRIDGE_OPERATOR_ROLE grants
 *   3. StratoRepresentationBridge version + BRIDGE_OPERATOR_ROLE grants
 *   4. StratoRepresentationToken: MINTER_ROLE grants + rep bridge mappings
 *   5. Vault rate limits (ETH, USDC, USDT)
 *   6. Rep bridge mint/burn rate limits per STRATO-native token
 *
 * Usage:
 *   node scripts/verifyBridgeConfig.js                   # both chains
 *   node scripts/verifyBridgeConfig.js --network sepolia
 *   node scripts/verifyBridgeConfig.js --network baseSepolia
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config();
require("dotenv").config({
  path: path.resolve(__dirname, "../../services/bridge/.env"),
});

const { ethers } = require("ethers");

// =============================================================================
// Config
// =============================================================================

const CHAIN_NAME_TO_ID = {
  sepolia: 11155111,
  baseSepolia: 84532,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CHAIN_TOKENS = {
  11155111: {
    ETH:  ZERO_ADDRESS,
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    USDT: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06",
  },
  84532: {
    ETH:  ZERO_ADDRESS,
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

const STRATO_NATIVE_TOKENS = {
  USDST:  "0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  GOLDST: "0xcdc93d30182125e05eec985b631c7c61b3f63ff0",
  SILVST: "0x2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
};

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR"));
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER"));
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// =============================================================================
// ABIs
// =============================================================================

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
];

const OWNABLE_ABI = [
  "function owner() view returns (address)",
];

const VERSION_ABI = [
  "function version() view returns (string)",
];

const PAUSABLE_ABI = [
  "function paused() view returns (bool)",
];

const DEPOSIT_ROUTER_ABI = [
  ...OWNABLE_ABI,
  ...VERSION_ABI,
  ...PAUSABLE_ABI,
  "function gnosisSafe() view returns (address)",
  "function PERMIT2() view returns (address)",
  "function depositId() view returns (uint96)",
];

const VAULT_ABI = [
  ...ACCESS_CONTROL_ABI,
  ...VERSION_ABI,
  ...PAUSABLE_ABI,
  "function remainingRateLimit(address token) view returns (uint256)",
  "function rateLimits(address token) view returns (uint256 maxAmount, uint256 windowDuration, uint256 currentAmount, uint256 windowStart)",
];

const REP_BRIDGE_ABI = [
  ...ACCESS_CONTROL_ABI,
  ...VERSION_ABI,
  ...PAUSABLE_ABI,
  "function stratoToRepresentation(address stratoToken) view returns (address)",
  "function getRepresentationToken(address stratoToken) view returns (address)",
  "function remainingMintLimit(address stratoToken) view returns (uint256)",
  "function remainingBurnLimit(address stratoToken) view returns (uint256)",
  "function mintRateLimits(address stratoToken) view returns (uint256 maxAmount, uint256 windowDuration, uint256 currentAmount, uint256 windowStart)",
  "function burnRateLimits(address stratoToken) view returns (uint256 maxAmount, uint256 windowDuration, uint256 currentAmount, uint256 windowStart)",
];

const REP_TOKEN_ABI = [
  ...ACCESS_CONTROL_ABI,
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { network: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--network" && argv[i + 1]) args.network = argv[++i];
  }
  return args;
}

function loadDeployment(contractName, networkName) {
  const filepath = path.resolve(
    __dirname,
    `../deployments/${contractName}_${networkName}_latest.json`,
  );
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

const CHECK = "✓";
const CROSS = "✗";
const WARN = "⚠";

let exitCode = 0;

function mark(pass, msg) {
  if (pass === true) return `${CHECK} ${msg}`;
  if (pass === false) { exitCode = 1; return `${CROSS} ${msg}`; }
  return `${WARN} ${msg}`;
}

function line(label, value) {
  return `  ${label.padEnd(34)} ${value}`;
}

async function readImplementation(provider, proxyAddress) {
  const raw = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  return ethers.getAddress("0x" + raw.slice(-40));
}

// =============================================================================
// Verification
// =============================================================================

async function verifyChain(networkName) {
  const chainId = CHAIN_NAME_TO_ID[networkName];
  if (!chainId) {
    console.error(`Unknown network: ${networkName}`);
    exitCode = 1;
    return;
  }

  const rpcUrl = process.env[`CHAIN_${chainId}_RPC_URL`];
  if (!rpcUrl) {
    console.error(`CHAIN_${chainId}_RPC_URL not set`);
    exitCode = 1;
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const safeAddress = process.env.SAFE_ADDRESS
    ? ethers.getAddress(process.env.SAFE_ADDRESS)
    : null;
  const hotWalletAddress = process.env.SAFE_HOT_WALLET_ADDRESS
    ? ethers.getAddress(process.env.SAFE_HOT_WALLET_ADDRESS)
    : null;

  console.log("\n" + "=".repeat(70));
  console.log(`VERIFY: ${networkName} (${chainId})`);
  console.log("=".repeat(70));
  console.log(line("Main Safe:", safeAddress || "NOT SET"));
  console.log(line("Hot Wallet:", hotWalletAddress || "(not configured)"));

  // ============================================================================
  // 1. DepositRouter
  // ============================================================================
  console.log("\n[1] DepositRouter");

  const drAddress = process.env[`CHAIN_${chainId}_DEPOSIT_ROUTER`];
  if (!drAddress) {
    console.log(mark(false, `CHAIN_${chainId}_DEPOSIT_ROUTER not set`));
  } else {
    console.log(line("Proxy:", drAddress));
    try {
      const drImpl = await readImplementation(provider, drAddress);
      console.log(line("Implementation:", drImpl));

      const dr = new ethers.Contract(drAddress, DEPOSIT_ROUTER_ABI, provider);
      const [version, owner, paused] = await Promise.all([
        dr.version().catch(() => "(unreadable)"),
        dr.owner().catch(() => "(unreadable)"),
        dr.paused().catch(() => null),
      ]);
      console.log(line("Version:", version));
      console.log(line("Owner:", owner));
      console.log(line("Paused:", paused === null ? "(unreadable)" : String(paused)));

      if (safeAddress) {
        const ownerIsSafe = owner.toLowerCase() === safeAddress.toLowerCase();
        console.log(mark(ownerIsSafe, `Owner is Safe: ${ownerIsSafe}`));
      }
    } catch (e) {
      console.log(mark(false, `Read failed: ${e.message}`));
    }
  }

  // ============================================================================
  // 2. ExternalBridgeVault
  // ============================================================================
  console.log("\n[2] ExternalBridgeVault");

  const vaultDeployment = loadDeployment("ExternalBridgeVault", networkName);
  if (!vaultDeployment) {
    console.log(mark(false, `No deployment file`));
  } else {
    const vaultAddress = vaultDeployment.addresses.proxy;
    console.log(line("Proxy:", vaultAddress));

    try {
      const impl = await readImplementation(provider, vaultAddress);
      console.log(line("Implementation:", impl));

      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
      const [version, paused] = await Promise.all([
        vault.version().catch((e) => `(unreadable: ${e.shortMessage || e.message})`),
        vault.paused().catch(() => null),
      ]);
      console.log(line("Version:", version));
      console.log(line("Paused:", paused === null ? "(unreadable)" : String(paused)));

      // Role checks
      if (safeAddress) {
        const hasAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, safeAddress);
        console.log(mark(hasAdmin, `Safe has DEFAULT_ADMIN_ROLE`));

        const hasOperator = await vault.hasRole(BRIDGE_OPERATOR_ROLE, safeAddress);
        console.log(mark(hasOperator, `Safe has BRIDGE_OPERATOR_ROLE`));
      }
      if (hotWalletAddress) {
        const hotHasOperator = await vault.hasRole(BRIDGE_OPERATOR_ROLE, hotWalletAddress);
        console.log(mark(hotHasOperator, `HotWallet has BRIDGE_OPERATOR_ROLE`));
      }

      // Rate limits for each known token
      console.log("  Rate limits:");
      const tokens = CHAIN_TOKENS[chainId] || {};
      for (const [symbol, tokenAddr] of Object.entries(tokens)) {
        try {
          const [maxAmount, windowDuration] = await vault.rateLimits(tokenAddr);
          const remaining = await vault.remainingRateLimit(tokenAddr);
          const configured = maxAmount > 0n;
          const label = `    ${symbol.padEnd(6)} max=${maxAmount.toString().padEnd(22)} window=${windowDuration}s remaining=${remaining.toString()}`;
          console.log(mark(configured, label));
        } catch (e) {
          console.log(mark(false, `    ${symbol}: read failed (${e.shortMessage || e.message})`));
        }
      }
    } catch (e) {
      console.log(mark(false, `Read failed: ${e.message}`));
    }
  }

  // ============================================================================
  // 3. StratoRepresentationBridge
  // ============================================================================
  console.log("\n[3] StratoRepresentationBridge");

  const repBridgeDeployment = loadDeployment("StratoRepresentationBridge", networkName);
  if (!repBridgeDeployment) {
    console.log(mark(false, `No deployment file`));
  } else {
    const rbAddress = repBridgeDeployment.addresses.proxy;
    console.log(line("Proxy:", rbAddress));

    try {
      const impl = await readImplementation(provider, rbAddress);
      console.log(line("Implementation:", impl));

      const rb = new ethers.Contract(rbAddress, REP_BRIDGE_ABI, provider);
      const [version, paused] = await Promise.all([
        rb.version().catch((e) => `(unreadable: ${e.shortMessage || e.message})`),
        rb.paused().catch(() => null),
      ]);
      console.log(line("Version:", version));
      console.log(line("Paused:", paused === null ? "(unreadable)" : String(paused)));

      if (safeAddress) {
        const hasAdmin = await rb.hasRole(DEFAULT_ADMIN_ROLE, safeAddress);
        console.log(mark(hasAdmin, `Safe has DEFAULT_ADMIN_ROLE`));

        const hasOperator = await rb.hasRole(BRIDGE_OPERATOR_ROLE, safeAddress);
        console.log(mark(hasOperator, `Safe has BRIDGE_OPERATOR_ROLE`));
      }
      if (hotWalletAddress) {
        const hotHasOperator = await rb.hasRole(BRIDGE_OPERATOR_ROLE, hotWalletAddress);
        console.log(mark(hotHasOperator, `HotWallet has BRIDGE_OPERATOR_ROLE`));
      }

      // Token mappings and rate limits
      console.log("  STRATO-native token mappings:");
      for (const [symbol, stratoAddr] of Object.entries(STRATO_NATIVE_TOKENS)) {
        try {
          const repToken = await rb.stratoToRepresentation(stratoAddr);
          const mapped = repToken !== ZERO_ADDRESS;

          if (!mapped) {
            console.log(mark(false, `    ${symbol.padEnd(6)} NOT MAPPED`));
            continue;
          }

          const [maxMint, windowMint] = await rb.mintRateLimits(stratoAddr);
          const [maxBurn, windowBurn] = await rb.burnRateLimits(stratoAddr);

          console.log(mark(true, `    ${symbol.padEnd(6)} → ${repToken}`));
          console.log(mark(
            maxMint > 0n,
            `      mint  max=${maxMint.toString().padEnd(22)} window=${windowMint}s`,
          ));
          console.log(mark(
            maxBurn > 0n,
            `      burn  max=${maxBurn.toString().padEnd(22)} window=${windowBurn}s`,
          ));
        } catch (e) {
          console.log(mark(false, `    ${symbol}: read failed (${e.shortMessage || e.message})`));
        }
      }
    } catch (e) {
      console.log(mark(false, `Read failed: ${e.message}`));
    }
  }

  // ============================================================================
  // 4. StratoRepresentationTokens
  // ============================================================================
  console.log("\n[4] StratoRepresentationTokens");

  const rbAddress = repBridgeDeployment?.addresses?.proxy;
  for (const symbol of Object.keys(STRATO_NATIVE_TOKENS)) {
    const tokenDeployment = loadDeployment(`StratoRepresentationToken_${symbol}`, networkName);
    if (!tokenDeployment) {
      console.log(mark(false, `${symbol}: no deployment file`));
      continue;
    }

    const tokenAddress = tokenDeployment.addresses.proxy;
    console.log(`  ${symbol}: ${tokenAddress}`);

    try {
      const token = new ethers.Contract(tokenAddress, REP_TOKEN_ABI, provider);
      const [name, tokenSymbol, totalSupply] = await Promise.all([
        token.name().catch(() => "(unreadable)"),
        token.symbol().catch(() => "(unreadable)"),
        token.totalSupply().catch(() => 0n),
      ]);
      console.log(line(`    ERC20 name/symbol:`, `${name} (${tokenSymbol})`));
      console.log(line(`    Total supply:`, totalSupply.toString()));

      if (rbAddress) {
        const hasMinter = await token.hasRole(MINTER_ROLE, rbAddress);
        console.log(mark(hasMinter, `    RepBridge has MINTER_ROLE`));
      }
      if (safeAddress) {
        const safeHasAdmin = await token.hasRole(DEFAULT_ADMIN_ROLE, safeAddress);
        console.log(mark(safeHasAdmin, `    Safe has DEFAULT_ADMIN_ROLE`));
      }
    } catch (e) {
      console.log(mark(false, `    Read failed: ${e.message}`));
    }
  }
}

async function main() {
  const args = parseArgs();
  const networks = args.network
    ? [args.network]
    : ["sepolia", "baseSepolia"];

  for (const net of networks) {
    await verifyChain(net);
  }

  console.log("\n" + "=".repeat(70));
  if (exitCode === 0) {
    console.log("RESULT: All checks passed ✓");
  } else {
    console.log("RESULT: Some checks FAILED ✗  (see marks above)");
  }
  console.log("=".repeat(70));

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("\nverifyBridgeConfig failed:", error.message);
  process.exit(1);
});

/**
 * Deploy the solver fast-path implementations and print the Safe calldata that
 * activates them.
 *
 * WHAT THIS DOES AND DOES NOT DO. Deploying an implementation is inert: nothing
 * points at it until the proxy is repointed. Every call that actually changes
 * behaviour -- `upgradeToAndCall` and `initializeFastPath` -- is `onlyOwner` or
 * role-gated to the custody Safe, and the proposer key this script runs with is
 * NOT a Safe owner. So this deploys, validates, and emits calldata; a Safe
 * owner submits it. Nothing here touches the Safe queue.
 *
 * `prepareUpgrade` is used rather than a bare deploy because it validates the
 * new layout against the LIVE proxy's implementation, not against a checked-in
 * copy of it -- the one check that cannot be faked locally.
 *
 *   PRIVATE_KEY=... npx hardhat run scripts/fastPathPrepare.js --network sepolia
 */
const { ethers, upgrades, network } = require("hardhat");

// Chosen for the testnet rollout: a six-hour half-life is twelve halvings
// across the three-day window, and a 5% ceiling makes occupying a claim with a
// dust payment cost a solver 95% of the amount, paid to the user.
const FEE_HALF_LIFE = 21600;
const MAX_FEE_BPS = 500;
const BOND_TTL = 604800;

const CUSTODY_SAFE = "0x8713850E9fF0fd0200ce87C32E3cdB24eD021631";
const HOT_WALLET = "0xc3cd4d012370f85c210cad670a28aa0c0a1a3aa5";

/**
 * `legacy` is the frozen copy of what is DEPLOYED behind each proxy.
 *
 * It is required, not optional. The OZ plugin has no manifest for a proxy this
 * machine did not deploy, and `forceImport` records "this address is an
 * implementation of this factory" WITHOUT checking bytecode. Importing with the
 * NEW factory therefore maps the new bytecode to the OLD address, after which
 * `prepareUpgrade` dedupes and hands back the address already running -- a
 * batch that upgrades to the current code and then reverts on
 * initializeFastPath, while printing every sign of success. Importing with the
 * legacy factory records the truth and lets prepareUpgrade deploy for real.
 */
const TARGETS = {
  sepolia: {
    chainId: 11155111,
    // 10 USDC (6 decimals) of the USDC the bridge already routes on this chain.
    bondToken: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    bondAmount: 10n * 10n ** 6n,
    contracts: [
      {
        name: "DepositRouter",
        legacy: "DepositRouterLegacyV3",
        proxy: "0x1f0457d1d8c3f0da3e579be3843dd6e093163b84",
        reinitVersion: 2,
      },
      {
        name: "StratoNativeRepresentationBridge",
        legacy: "StratoNativeRepresentationBridgeLegacyV1",
        proxy: "0x80f6497e8f8700c89b3a0b030c3e71aa874f6cf7",
        // 3, because the v1.1.0 MINT_EXECUTOR_ROLE upgrade already burned 2.
        reinitVersion: 3,
      },
    ],
  },
  baseSepolia: {
    chainId: 84532,
    bondToken: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    bondAmount: 10n * 10n ** 6n,
    // Base Sepolia runs the Mercata bridge only; there is no native route
    // configured for it on STRATO, so there is no representation bridge here.
    contracts: [
      {
        name: "DepositRouter",
        legacy: "DepositRouterLegacyV3",
        proxy: "0x35fa3e487f0edfdfda90ecfec15399bdb8bba199",
        reinitVersion: 2,
      },
    ],
  },
};

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// ERC-7201 namespace of OZ Initializable: uint64 _initialized packed low.
const INITIALIZABLE_SLOT = "0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00";

const currentImplementation = async (proxy) =>
  ethers.getAddress("0x" + (await ethers.provider.getStorage(proxy, IMPL_SLOT)).slice(26));

const initializedVersion = async (proxy) =>
  Number(BigInt("0x" + (await ethers.provider.getStorage(proxy, INITIALIZABLE_SLOT)).slice(-16)));

/**
 * `reinitializer(n)` requires the PROXY's `_initialized` to be below n, and
 * that counter has nothing to do with the contract's release number. A proxy
 * reinitialized once before is already at 2, so a second `reinitializer(2)`
 * reverts with InvalidInitialization() -- inside a MultiSend that surfaces only
 * as the Safe's GS013, with no hint which call failed. A fresh local deployment
 * sits at 1, so tests pass either way and only the live chain knows. Checked
 * here because an upgrade batch that cannot possibly configure the contract
 * should never be printed as if it were ready to submit.
 */
async function assertReinitializerCanRun(target) {
  if (!target.reinitVersion) throw new Error(`${target.name}: reinitVersion not declared`);
  const live = await initializedVersion(target.proxy);
  if (live >= target.reinitVersion) {
    throw new Error(
      `${target.name} at ${target.proxy}: proxy _initialized is ${live}, but ` +
      `initializeFastPath is reinitializer(${target.reinitVersion}) -- it would revert. ` +
      `Bump the reinitializer above ${live} and redeploy.`,
    );
  }
  console.log(`  reinitializer(${target.reinitVersion}) ok against live _initialized ${live}`);
}

/** Calldata the Safe must send to activate a freshly deployed implementation. */
function activationCalls(name, proxy, impl, cfg) {
  const upgradeable = new ethers.Interface([
    "function upgradeToAndCall(address newImplementation, bytes data)",
  ]);
  const calls = [{
    label: `${name}.upgradeToAndCall(${impl})`,
    to: proxy,
    value: "0",
    data: upgradeable.encodeFunctionData("upgradeToAndCall", [impl, "0x"]),
  }];

  if (name === "DepositRouter") {
    const iface = new ethers.Interface([
      "function initializeFastPath(uint64 halfLifeSeconds,uint16 feeBpsCeiling,address bondToken,uint256 bondAmount,address slashRecipient,uint64 ttlSeconds,address[] settlers)",
    ]);
    calls.push({
      label: `${name}.initializeFastPath(...)`,
      to: proxy,
      value: "0",
      // The settlers are the two wallets that actually route payouts. Omit
      // either and settleWithdrawal reverts for every withdrawal it handles.
      data: iface.encodeFunctionData("initializeFastPath", [
        FEE_HALF_LIFE, MAX_FEE_BPS, cfg.bondToken, cfg.bondAmount,
        CUSTODY_SAFE, BOND_TTL, [CUSTODY_SAFE, HOT_WALLET],
      ]),
    });
  } else {
    const iface = new ethers.Interface([
      "function initializeFastPath(uint64 halfLifeSeconds,uint16 feeBpsCeiling,address bondToken,uint256 bondAmount,address slashRecipient,uint64 ttlSeconds)",
    ]);
    calls.push({
      label: `${name}.initializeFastPath(...)`,
      to: proxy,
      value: "0",
      data: iface.encodeFunctionData("initializeFastPath", [
        FEE_HALF_LIFE, MAX_FEE_BPS, cfg.bondToken, cfg.bondAmount,
        CUSTODY_SAFE, BOND_TTL,
      ]),
    });
  }
  return calls;
}

async function main() {
  const cfg = TARGETS[network.name];
  if (!cfg) throw new Error(`no fast-path target for network ${network.name}`);

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`network ${network.name} (${cfg.chainId})`);
  console.log(`deployer ${signer.address}  balance ${ethers.formatEther(balance)} ETH\n`);

  const batch = [];
  for (const target of cfg.contracts) {
    const factory = await ethers.getContractFactory(target.name);
    console.log(`--- ${target.name} proxy ${target.proxy}`);

    const before = await currentImplementation(target.proxy);
    console.log(`  live implementation: ${before}`);
    await assertReinitializerCanRun(target);

    // Register the live implementation under the LEGACY factory -- the truth --
    // so the layout comparison is old-against-new and prepareUpgrade actually
    // deploys something.
    const legacyFactory = await ethers.getContractFactory(target.legacy);
    try {
      await upgrades.forceImport(target.proxy, legacyFactory, { kind: "uups" });
    } catch (e) {
      if (!/already/i.test(e.message)) throw e;
    }

    const impl = await upgrades.prepareUpgrade(target.proxy, factory, { kind: "uups" });

    // The guard for the failure above: if prepareUpgrade hands back the address
    // already running, the manifest is lying and the batch would be a no-op
    // followed by a revert. Refuse to emit calldata for that.
    if (ethers.getAddress(String(impl)) === before) {
      throw new Error(
        `prepareUpgrade returned the LIVE implementation (${impl}) for ${target.name}. ` +
        `The manifest maps new bytecode to the old address; delete .openzeppelin ` +
        `and re-run so the legacy factory is imported first.`
      );
    }

    console.log(`  new implementation:  ${impl}`);
    console.log(`  layout validated ${target.legacy} -> ${target.name}`);
    batch.push(...activationCalls(target.name, target.proxy, impl, cfg));
  }

  console.log(`\n===== Safe batch for ${network.name} =====`);
  console.log(`Safe: ${CUSTODY_SAFE}  (threshold 1 -- one owner signature executes)`);
  console.log("Submit these as a single MultiSend so no proxy is ever upgraded-but-unconfigured:\n");
  batch.forEach((c, i) => {
    console.log(`  [${i}] ${c.label}`);
    console.log(`      to:    ${c.to}`);
    console.log(`      value: ${c.value}`);
    console.log(`      data:  ${c.data}\n`);
  });
  require("fs").writeFileSync(
    `/tmp/fastpath-safe-batch-${network.name}.json`,
    JSON.stringify({ safe: CUSTODY_SAFE, chainId: cfg.chainId, transactions: batch }, null, 2)
  );
  console.log(`written: /tmp/fastpath-safe-batch-${network.name}.json`);
  console.log(
    `\nDry-run it before submitting -- the calls are sequential and only a fork\n` +
    `executes them in order (public RPCs ignore eth_call state overrides):\n` +
    `  FORK_RPC_URL=<rpc> FORK_BLOCK=<head> BATCH=/tmp/fastpath-safe-batch-${network.name}.json \\\n` +
    `    npx hardhat run scripts/fastPathForkDryRun.js`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });

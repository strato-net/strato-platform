#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DEFAULT_BASE_URL,
  DEFAULT_VAULT_ADDRESS,
  normalizeAddress,
  readToken,
  cirrusSearch,
  getUser,
  getVaultRow,
  getTokenBalance,
  sendFunctionTx,
  parseHumanAmount,
  formatWei,
  printJson,
} = require("./common");

function usage() {
  console.log(`
Usage:
  node scripts/yield-vault-live/vaultDirectFlow.js inspect
  node scripts/yield-vault-live/vaultDirectFlow.js set-strategy <strategyAddress>
  node scripts/yield-vault-live/vaultDirectFlow.js deposit <humanAmount> [receiverAddress]
  node scripts/yield-vault-live/vaultDirectFlow.js deploy <humanAmount> <strategyAddress>
  node scripts/yield-vault-live/vaultDirectFlow.js approve-return <humanAmount>
  node scripts/yield-vault-live/vaultDirectFlow.js return <humanAmount> <strategyAddress>
  node scripts/yield-vault-live/vaultDirectFlow.js redeem <humanShareAmount> [receiverAddress]
  node scripts/yield-vault-live/vaultDirectFlow.js demo <depositHuman> <deployHuman> <returnHuman>
  node scripts/yield-vault-live/vaultDirectFlow.js profit-demo <depositHuman> <deployHuman> <returnHuman>

Notes:
  - Defaults to vault ${DEFAULT_VAULT_ADDRESS}
  - Reads bearer token from ~/.secrets/stratoToken unless ACCESS_TOKEN is set
  - Uses ACTOR_ADDRESS if provided, otherwise tries /api/user/me
  - 'approve-return' approves the vault to pull underlying back from the current actor
  - 'demo' assumes strategyAddress == current actor address
  - 'profit-demo' also assumes strategyAddress == current actor address and saves state after each step
`);
}

async function resolveActorAddress(baseUrl, token) {
  if (process.env.ACTOR_ADDRESS) {
    return normalizeAddress(process.env.ACTOR_ADDRESS);
  }
  const user = await getUser(baseUrl, token);
  return normalizeAddress(user.userAddress);
}

async function fetchState(baseUrl, token, actorAddress, vaultAddress) {
  const vault = await getVaultRow(baseUrl, token, vaultAddress);
  const strategyRows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault-approvedStrategies", {
    address: `eq.${vaultAddress}`,
  });
  const debtRows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault-strategyDebt", {
    address: `eq.${vaultAddress}`,
  });
  const claimRows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault-claimableAssets", {
    address: `eq.${vaultAddress}`,
  });
  const shareRows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault-_balances", {
    address: `eq.${vaultAddress}`,
  });
  const assetToken = await cirrusSearch(baseUrl, token, "BlockApps-Token", {
    address: `eq.${vault._asset}`,
  });
  const vaultAssetBalance = await getTokenBalance(baseUrl, token, vault._asset, vaultAddress);
  const actorAssetBalance = await getTokenBalance(baseUrl, token, vault._asset, actorAddress);
  const actorShareBalanceRows = await cirrusSearch(baseUrl, token, "BlockApps-YieldVault-_balances", {
    address: `eq.${vaultAddress}`,
    key: `eq.${actorAddress}`,
  });

  return {
    capturedAt: new Date().toISOString(),
    actor: {
      address: actorAddress,
      assetBalance: actorAssetBalance,
      assetBalanceHuman: formatWei(actorAssetBalance),
      shareBalance: actorShareBalanceRows?.[0]?.value || "0",
      shareBalanceHuman: actorShareBalanceRows?.[0]?.value ? formatWei(actorShareBalanceRows[0].value) : "0",
    },
    vault,
    approvedStrategies: strategyRows,
    strategyDebt: debtRows,
    claimableAssets: claimRows,
    shareBalances: shareRows,
    assetToken,
    vaultAssetBalance,
    vaultAssetBalanceHuman: formatWei(vaultAssetBalance),
  };
}

function printState(state) {
  printJson("vault", state.vault);
  printJson("approvedStrategies", state.approvedStrategies);
  printJson("strategyDebt", state.strategyDebt);
  printJson("claimableAssets", state.claimableAssets);
  printJson("shareBalances", state.shareBalances);
  printJson("assetToken", state.assetToken);

  console.log("\n## actor");
  console.log(`address: ${state.actor.address}`);
  console.log(`assetBalance: ${state.actor.assetBalanceHuman}`);
  console.log(`shareBalance: ${state.actor.shareBalanceHuman}`);
  console.log(`vaultAssetBalance: ${state.vaultAssetBalanceHuman}`);
}

async function inspect(baseUrl, token, actorAddress, vaultAddress) {
  const state = await fetchState(baseUrl, token, actorAddress, vaultAddress);
  printState(state);
}

function makeRunDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), "scripts", "yield-vault-live", "runs", stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, step, extra = {}) {
  const state = await fetchState(baseUrl, token, actorAddress, vaultAddress);
  const payload = { step, ...extra, state };
  const file = path.join(runDir, `${String(step).padStart(2, "0")}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`Saved snapshot: ${file}`);
  return payload;
}

async function setStrategy(baseUrl, token, vaultAddress, strategyAddress) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "YieldVault",
    contractAddress: vaultAddress,
    method: "setStrategyApproval",
    args: { strategy: strategyAddress, approved: true },
  });
  printJson("setStrategyApproval result", res);
}

async function deposit(baseUrl, token, actorAddress, vaultAddress, humanAmount, receiverAddress) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "YieldVault",
    contractAddress: vaultAddress,
    method: "deposit",
    args: {
      assets: parseHumanAmount(humanAmount),
      receiver: receiverAddress || actorAddress,
    },
  });
  printJson("deposit result", res);
}

async function deploy(baseUrl, token, vaultAddress, humanAmount, strategyAddress) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "YieldVault",
    contractAddress: vaultAddress,
    method: "deployCapital",
    args: {
      to: strategyAddress,
      assets: parseHumanAmount(humanAmount),
    },
  });
  printJson("deployCapital result", res);
}

async function approveReturn(baseUrl, token, vaultAddress, assetAddress, humanAmount) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "Token",
    contractAddress: assetAddress,
    method: "approve",
    args: {
      spender: vaultAddress,
      value: parseHumanAmount(humanAmount),
    },
  });
  printJson("asset approve result", res);
}

async function returnCapital(baseUrl, token, vaultAddress, humanAmount, strategyAddress) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "YieldVault",
    contractAddress: vaultAddress,
    method: "returnCapital",
    args: {
      from: strategyAddress,
      assets: parseHumanAmount(humanAmount),
    },
  });
  printJson("returnCapital result", res);
}

async function redeem(baseUrl, token, actorAddress, vaultAddress, humanShareAmount, receiverAddress) {
  const res = await sendFunctionTx(baseUrl, token, {
    contractName: "YieldVault",
    contractAddress: vaultAddress,
    method: "redeem",
    args: {
      shares: parseHumanAmount(humanShareAmount),
      receiver: receiverAddress || actorAddress,
      owner_: actorAddress,
    },
  });
  printJson("redeem result", res);
}

async function profitDemo(baseUrl, token, actorAddress, vaultAddress, vault, depositHuman, deployHuman, returnHuman) {
  const strategy = actorAddress;
  const runDir = makeRunDir();
  console.log(`Using actor as temporary strategy: ${strategy}`);
  console.log(`Saving snapshots under: ${runDir}`);

  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 0, { label: "before" });

  await setStrategy(baseUrl, token, vaultAddress, strategy);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 1, {
    label: "after setStrategyApproval",
    action: { method: "setStrategyApproval", strategy, approved: true },
  });

  await approveReturn(baseUrl, token, vaultAddress, normalizeAddress(vault._asset), depositHuman);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 2, {
    label: "after deposit approve",
    action: { method: "Token.approve", valueHuman: depositHuman },
  });

  await deposit(baseUrl, token, actorAddress, vaultAddress, depositHuman, actorAddress);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 3, {
    label: "after deposit",
    action: { method: "deposit", assetsHuman: depositHuman },
  });

  await deploy(baseUrl, token, vaultAddress, deployHuman, strategy);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 4, {
    label: "after deployCapital",
    action: { method: "deployCapital", assetsHuman: deployHuman, strategy },
  });

  await approveReturn(baseUrl, token, vaultAddress, normalizeAddress(vault._asset), returnHuman);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 5, {
    label: "after return approve",
    action: { method: "Token.approve", valueHuman: returnHuman },
  });

  await returnCapital(baseUrl, token, vaultAddress, returnHuman, strategy);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 6, {
    label: "after returnCapital",
    action: { method: "returnCapital", assetsHuman: returnHuman, strategy },
  });

  await redeem(baseUrl, token, actorAddress, vaultAddress, depositHuman, actorAddress);
  await saveSnapshot(baseUrl, token, actorAddress, vaultAddress, runDir, 7, {
    label: "after redeem",
    action: { method: "redeem", sharesHuman: depositHuman },
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    usage();
    process.exit(1);
  }

  const baseUrl = DEFAULT_BASE_URL;
  const vaultAddress = DEFAULT_VAULT_ADDRESS;
  const token = readToken();
  const actorAddress = await resolveActorAddress(baseUrl, token);
  const vault = await getVaultRow(baseUrl, token, vaultAddress);

  switch (command) {
    case "inspect":
      await inspect(baseUrl, token, actorAddress, vaultAddress);
      break;

    case "set-strategy":
      if (!args[0]) throw new Error("strategyAddress required");
      await setStrategy(baseUrl, token, vaultAddress, normalizeAddress(args[0]));
      break;

    case "deposit":
      if (!args[0]) throw new Error("humanAmount required");
      await deposit(baseUrl, token, actorAddress, vaultAddress, args[0], normalizeAddress(args[1] || actorAddress));
      break;

    case "deploy":
      if (!args[0] || !args[1]) throw new Error("humanAmount and strategyAddress required");
      await deploy(baseUrl, token, vaultAddress, args[0], normalizeAddress(args[1]));
      break;

    case "approve-return":
      if (!args[0]) throw new Error("humanAmount required");
      await approveReturn(baseUrl, token, vaultAddress, normalizeAddress(vault._asset), args[0]);
      break;

    case "return":
      if (!args[0] || !args[1]) throw new Error("humanAmount and strategyAddress required");
      await returnCapital(baseUrl, token, vaultAddress, args[0], normalizeAddress(args[1]));
      break;

    case "redeem":
      if (!args[0]) throw new Error("humanShareAmount required");
      await redeem(baseUrl, token, actorAddress, vaultAddress, args[0], normalizeAddress(args[1] || actorAddress));
      break;

    case "demo": {
      if (!args[0] || !args[1] || !args[2]) {
        throw new Error("demo requires depositHuman deployHuman returnHuman");
      }
      const strategy = actorAddress;
      console.log(`Using actor as temporary strategy: ${strategy}`);
      await setStrategy(baseUrl, token, vaultAddress, strategy);
      await deposit(baseUrl, token, actorAddress, vaultAddress, args[0], actorAddress);
      await deploy(baseUrl, token, vaultAddress, args[1], strategy);
      await approveReturn(baseUrl, token, vaultAddress, normalizeAddress(vault._asset), args[2]);
      await returnCapital(baseUrl, token, vaultAddress, args[2], strategy);
      await redeem(baseUrl, token, actorAddress, vaultAddress, args[0], actorAddress);
      break;
    }

    case "profit-demo": {
      if (!args[0] || !args[1] || !args[2]) {
        throw new Error("profit-demo requires depositHuman deployHuman returnHuman");
      }
      await profitDemo(baseUrl, token, actorAddress, vaultAddress, vault, args[0], args[1], args[2]);
      break;
    }

    default:
      usage();
      process.exit(1);
  }
}

main().catch((error) => {
  const message = error?.body ? JSON.stringify(error.body, null, 2) : error.message || String(error);
  console.error(message);
  process.exit(1);
});

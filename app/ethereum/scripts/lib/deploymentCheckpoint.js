const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function writeCheckpoint(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function openDeploymentCheckpoint(file, binding, artifactFiles) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = fs.openSync(`${file}.lock`, "wx", 0o600);
  const close = () => { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); };
  try {
    const exists = fs.existsSync(file);
    if (!exists && artifactFiles.some(candidate => fs.existsSync(candidate))) {
      throw new Error("Deployment artifact already exists without a checkpoint; reconcile it before deploying");
    }
    const state = exists ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: 1, binding, steps: {} };
    if (state.version !== 1 || JSON.stringify(state.binding) !== JSON.stringify(binding) || !state.steps || typeof state.steps !== "object") {
      throw new Error("Deployment checkpoint does not match this chain, signer, configuration or contract build");
    }
    const save = () => writeCheckpoint(file, state);
    save();
    return { state, save, close };
  } catch (error) { close(); throw error; }
}

async function waitForTransaction(provider, transactionHash, confirmations, timeout) {
  if (typeof provider.waitForTransaction === "function") {
    try {
      return await provider.waitForTransaction(transactionHash, confirmations, timeout);
    } catch (error) {
      if (!String(error?.message || error).includes("waitForTransaction' is not implemented")) {
        throw error;
      }
    }
  }

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (receipt) {
      const latestBlock = await provider.getBlockNumber();
      if (latestBlock - receipt.blockNumber + 1 >= confirmations) return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  return null;
}

async function resumeProxyDeployment(journal, name, deploy, factory, provider, upgrades, confirmations, validate) {
  let step = journal.state.steps[name];
  if (!step) {
    step = journal.state.steps[name] = { status: "deploying" };
    journal.save();
    const contract = await deploy();
    const tx = contract.deploymentTransaction();
    if (!tx) throw new Error(`${name} deployment transaction unavailable`);
    step.proxy = await contract.getAddress();
    step.transactionHash = tx.hash;
    step.status = "submitted";
    journal.save();
  }
  if (!/^0x[0-9a-f]{40}$/i.test(step.proxy || "") || !/^0x[0-9a-f]{64}$/i.test(step.transactionHash || "")) {
    throw new Error(`${name} deployment outcome is uncertain; reconcile the deployer transactions and checkpoint before retrying`);
  }
  const timeout = Math.max(120_000, confirmations * 15_000);
  const receipt = await waitForTransaction(provider, step.transactionHash, confirmations, timeout);
  if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== step.proxy.toLowerCase()) {
    throw new Error(`${name} deployment receipt is missing, failed or mismatched`);
  }
  if (await provider.getCode(step.proxy) === "0x") throw new Error(`${name} proxy has no bytecode`);
  const implementation = await upgrades.erc1967.getImplementationAddress(step.proxy);
  if (step.implementation && step.implementation.toLowerCase() !== implementation.toLowerCase()) {
    throw new Error(`${name} implementation changed since checkpoint`);
  }
  if (await provider.getCode(implementation) === "0x") throw new Error(`${name} implementation has no bytecode`);
  const contract = factory.attach(step.proxy);
  await validate(contract);
  Object.assign(step, { status: "verified", implementation, blockNumber: receipt.blockNumber });
  journal.save();
  return { contract, receipt, implementation };
}

module.exports = { writeCheckpoint, openDeploymentCheckpoint, resumeProxyDeployment };

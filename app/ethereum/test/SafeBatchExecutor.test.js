const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ethers } = require("ethers");
const {
  getSafeL2SingletonDeployment,
  getProxyFactoryDeployment,
  getMultiSendDeployment,
  getMultiSendCallOnlyDeployment,
} = require("@safe-global/safe-deployments");
const {
  decodeCall,
  validateBatch,
  validateSignature,
  addSignatures,
  requireExecutorGas,
  requireExecutionSuccess,
  executeSignedBatch,
} = require("../scripts/lib/safeBatchExecutor");
const { proposeBatch } = require("../scripts/lib/depositRouterSafeOps");
const { parseArgs } = require("../scripts/safeBatch");
const { safeCommands } = require("../scripts/lib/rolloutOutput");

const safe = "0x2222222222222222222222222222222222222222";
const ownerOne = "0x1111111111111111111111111111111111111111";
const ownerTwo = "0x3333333333333333333333333333333333333333";
const executor = "0x5555555555555555555555555555555555555555";
const signature = `0x${"11".repeat(65)}`;

function batch(overrides = {}) {
  return {
    version: "1.0",
    chainId: "59141",
    meta: { createdFromSafeAddress: safe },
    transactions: [{
      to: "0x4444444444444444444444444444444444444444",
      value: "0",
      data: "0x12345678",
    }],
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    chainId: 59141,
    safeAddress: safe,
    owners: [ownerOne, ownerTwo],
    threshold: 2,
    nonce: 4,
    currentNonce: 4,
    executorAddress: executor,
    safeTxHash: `0x${"ab".repeat(32)}`,
    safeTransaction: { addSignature: () => {} },
    ...overrides,
  };
}

function record(signer, overrides = {}) {
  const current = context();
  return {
    format: "eab-safe-signature",
    chainId: String(current.chainId),
    safeAddress: current.safeAddress,
    nonce: current.nonce,
    safeTxHash: current.safeTxHash,
    signer,
    signature,
    ...overrides,
  };
}

test("Safe deployment registry resolves Linea Sepolia contracts", () => {
  const filter = { network: "59141" };
  for (const deployment of [
    getSafeL2SingletonDeployment(filter),
    getProxyFactoryDeployment(filter),
    getMultiSendDeployment(filter),
    getMultiSendCallOnlyDeployment(filter),
  ]) {
    assert.match(deployment.defaultAddress, /^0x[0-9a-fA-F]{40}$/);
  }
});

test("validates the Safe batch chain and address", () => {
  const result = validateBatch(batch(), { chainId: 59141, safeAddress: safe });
  assert.equal(result.chainId, 59141);
  assert.equal(result.safeAddress, safe);
  assert.throws(() => validateBatch(batch(), { chainId: 11155111 }), /does not match/);
  assert.throws(
    () => validateBatch(batch(), { safeAddress: "0x5555555555555555555555555555555555555555" }),
    /does not match/,
  );
});

test("requires explicit expected chain and Safe arguments", () => {
  assert.throws(() => parseArgs(["inspect", "--file", "batch.json"]), /Usage/);
  assert.throws(
    () => parseArgs(["inspect", "--file", "batch.json", "--chain-id", "59141", "--safee", safe]),
    /Invalid argument/,
  );
});

test("prints complete bound inspect, sign, and execute commands", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "safe-commands-"));
  const file = path.join(directory, "batch.safe.json");
  fs.writeFileSync(file, JSON.stringify(batch()));
  const commands = safeCommands(file);
  assert.match(commands.inspect, /safe:batch -- inspect/);
  assert.match(commands.sign, /safe:batch -- sign/);
  assert.match(commands.execute, /safe:batch -- execute/);
  for (const command of Object.values(commands)) {
    assert.match(command, /--chain-id '59141'/);
    assert.match(command, new RegExp(`--safe '${safe}'`, "i"));
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

test("decodes reviewable methods and arguments", () => {
  const iface = new ethers.Interface([
    "function setPause(bool depositsPaused, bool withdrawalsPaused)",
  ]);
  const decoded = decodeCall(iface.encodeFunctionData("setPause", [true, false]), [iface]);
  assert.deepEqual(decoded, {
    method: "setPause(bool,bool)",
    args: { depositsPaused: true, withdrawalsPaused: false },
  });
});

test("hosted Safe proposals fail clearly on Linea Sepolia", async () => {
  await assert.rejects(
    proposeBatch(59141, [], { safeAddress: safe }),
    /no supported hosted Safe Transaction Service/,
  );
});

test("rejects mismatched and insufficient signature files", () => {
  assert.throws(
    () => validateSignature(record(ownerOne, { chainId: "1" }), context()),
    /does not match/,
  );
  assert.throws(() => addSignatures(context(), [record(ownerOne)]), /requires 2 owner signatures/);
  assert.throws(
    () => addSignatures(context(), [record(ownerOne), record(ownerOne)]),
    /Duplicate Safe signature/,
  );
});

test("executes only the reviewed hash and verifies receipt and nonce", async () => {
  let signatures = 0;
  const events = new ethers.Interface([
    "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  ]);
  const success = events.encodeEventLog(events.getEvent("ExecutionSuccess"), [context().safeTxHash, 0]);
  const current = context({
    safeTransaction: { addSignature: () => { signatures += 1; } },
    protocolKit: {
      isValidTransaction: async () => true,
      getEncodedTransaction: async () => "0x1234",
      executeTransaction: async () => ({ hash: `0x${"cd".repeat(32)}` }),
      getNonce: async () => 5,
    },
    provider: {
      getBalance: async () => 1_000_000n,
      getFeeData: async () => ({ gasPrice: 2n }),
      estimateGas: async () => 100_000n,
      waitForTransaction: async () => ({
        status: 1,
        logs: [{ address: safe, topics: success.topics, data: success.data }],
      }),
    },
  });
  await assert.rejects(
    executeSignedBatch(current, [record(ownerOne), record(ownerTwo)], `0x${"ef".repeat(32)}`),
    /does not match/,
  );
  const result = await executeSignedBatch(
    current,
    [record(ownerOne), record(ownerTwo)],
    current.safeTxHash,
  );
  assert.equal(signatures, 2);
  assert.equal(result.nonce, 4);
});

test("rejects an outer success when the Safe reports execution failure", () => {
  const events = new ethers.Interface([
    "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
  ]);
  const current = context();
  const failure = events.encodeEventLog(events.getEvent("ExecutionFailure"), [current.safeTxHash, 0]);
  assert.throws(
    () => requireExecutionSuccess({
      logs: [{ address: safe, topics: failure.topics, data: failure.data }],
    }, safe, current.safeTxHash),
    /ExecutionFailure/,
  );
});

test("rejects an executor without enough native gas", async () => {
  await assert.rejects(
    requireExecutorGas(context({
      protocolKit: { getEncodedTransaction: async () => "0x1234" },
      provider: {
        getBalance: async () => 10n,
        getFeeData: async () => ({ maxFeePerGas: 2n }),
        estimateGas: async () => 100n,
      },
    })),
    /insufficient gas balance/,
  );
});

test("stale signed nonces stop for live reconciliation", async () => {
  const current = context({ currentNonce: 5 });
  await assert.rejects(
    executeSignedBatch(current, [record(ownerOne), record(ownerTwo)], current.safeTxHash),
    /reconcile live state/,
  );
});

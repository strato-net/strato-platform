const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDeploymentCheckpoint, resumeProxyDeployment } = require("../scripts/lib/deploymentCheckpoint");

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-deploy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "checkpoint.json");
  const binding = { chainId: "1", signer: "owner", build: "code" };
  let deployments = 0, receiptAvailable = true, implementation = "0x" + "3".repeat(40);
  const proxy = "0x" + "1".repeat(40), hash = "0x" + "2".repeat(64);
  const contract = { getAddress: async () => proxy, deploymentTransaction: () => ({ hash }) };
  const factory = { attach: address => { assert.equal(address, proxy); return contract; } };
  const provider = { getCode: async () => "0x1234", waitForTransaction: async (tx, confirmations) => {
    assert.equal(tx, hash); assert.equal(confirmations, 3);
    return receiptAvailable ? { status: 1, contractAddress: proxy, blockNumber: 12 } : null;
  } };
  const upgrades = { erc1967: { getImplementationAddress: async () => implementation } };
  const open = () => openDeploymentCheckpoint(file, binding, []);
  const deploy = async () => { deployments++; return contract; };
  const run = (journal, name = "vault", validate = async () => {}) => resumeProxyDeployment(journal, name, deploy, factory, provider, upgrades, 3, validate);
  return { file, directory, binding, open, run, factory, provider, upgrades,
    deployments: () => deployments, receipt: value => { receiptAvailable = value; }, implementation: value => { implementation = value; } };
}

test("a receipt timeout resumes the saved proxy without redeployment", async t => {
  const h = harness(t);
  let journal = h.open();
  h.receipt(false);
  await assert.rejects(h.run(journal), /receipt/);
  journal.close();
  assert.equal(JSON.parse(fs.readFileSync(h.file)).steps.vault.status, "submitted");
  h.receipt(true); journal = h.open();
  await h.run(journal);
  assert.equal(h.deployments(), 1);
  assert.equal(journal.state.steps.vault.status, "verified");
  journal.close();
});

test("polls receipts when the Hardhat provider cannot wait for transactions", async t => {
  const h = harness(t);
  h.provider.waitForTransaction = async () => {
    throw new Error("Method 'HardhatEthersProvider.waitForTransaction' is not implemented");
  };
  h.provider.getTransactionReceipt = async () => ({
    status: 1,
    contractAddress: "0x" + "1".repeat(40),
    blockNumber: 12,
  });
  h.provider.getBlockNumber = async () => 14;
  const journal = h.open();
  await h.run(journal);
  assert.equal(h.deployments(), 1);
  assert.equal(journal.state.steps.vault.status, "verified");
  journal.close();
});

test("a later configuration failure preserves both deployments and revalidates on restart", async t => {
  const h = harness(t);
  let journal = h.open();
  await h.run(journal);
  await assert.rejects(h.run(journal, "router", async () => { throw new Error("wrong owner"); }), /wrong owner/);
  journal.close(); journal = h.open();
  await h.run(journal); await h.run(journal, "router");
  assert.equal(h.deployments(), 2);
  h.implementation("0x" + "4".repeat(40));
  await assert.rejects(h.run(journal), /implementation changed/);
  journal.close();
});

test("an ambiguous deploy submission cannot silently create another proxy", async t => {
  const h = harness(t);
  let journal = h.open();
  await assert.rejects(resumeProxyDeployment(journal, "vault", async () => { throw new Error("lost response"); },
    h.factory, h.provider, h.upgrades, 3, async () => {}), /lost response/);
  journal.close(); journal = h.open();
  await assert.rejects(h.run(journal), /outcome is uncertain/);
  assert.equal(h.deployments(), 0);
  journal.close();
});

test("rejects concurrent writers, changed configuration, corrupt state and orphaned artifacts", t => {
  const h = harness(t);
  const journal = h.open();
  assert.throws(h.open, /EEXIST/);
  journal.close();
  assert.throws(() => openDeploymentCheckpoint(h.file, { ...h.binding, chainId: "2" }, []), /does not match/);
  fs.writeFileSync(h.file, "{broken");
  assert.throws(h.open);
  const artifact = path.join(h.directory, "latest.json");
  fs.writeFileSync(artifact, "{}");
  assert.throws(() => openDeploymentCheckpoint(path.join(h.directory, "new.json"), h.binding, [artifact]), /artifact already exists/);
});

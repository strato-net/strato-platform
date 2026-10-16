const test = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const {
  normalizeConfig,
  buildSignerOperations,
  readState,
} = require("../scripts/nativeBridgeSignerOps");
const addr = (n) => ethers.getAddress(ethers.toBeHex(n, 20));
const input = () => ({
  chainId: 11155111,
  bridgeAddress: addr(10),
  safeAddress: addr(11),
  attestationSigners: [addr(1), addr(2), addr(3)],
  disabledAttestationSigners: [addr(4)],
  attestationThreshold: 2,
});
const state = (enabled, threshold) => ({
  count: enabled.length,
  threshold,
  enabled: Object.fromEntries(
    [1, 2, 3, 4].map((n) => [addr(n), enabled.includes(n)])
  ),
});
test("adds replacements before threshold and legacy removal", () => {
  assert.deepEqual(
    buildSignerOperations(normalizeConfig(input()), state([4], 1)).map(
      (o) => o.args
    ),
    [[addr(1), true], [addr(2), true], [addr(3), true], [2], [addr(4), false]]
  );
});
test("removes extra legacy signer from configured quorum", () => {
  assert.deepEqual(
    buildSignerOperations(normalizeConfig(input()), state([1, 2, 3, 4], 2)),
    [{ method: "setAttestationSigner", args: [addr(4), false] }]
  );
});
test("fails closed on an unaccounted signer", () => {
  const s = state([1, 2, 3], 2);
  s.count = 4;
  assert.throws(
    () => buildSignerOperations(normalizeConfig(input()), s),
    /Unaccounted/
  );
});
test("completed rotation is idempotent", () =>
  assert.deepEqual(
    buildSignerOperations(normalizeConfig(input()), state([1, 2, 3], 2)),
    []
  ));
test("lowering threshold before removals preserves valid intermediate counts", () => {
  const s = state([1, 2, 3, 4], 4);
  for (const op of buildSignerOperations(normalizeConfig(input()), s)) {
    if (op.method === "setAttestationThreshold") s.threshold = op.args[0];
    else s.count += op.args[1] ? 1 : -1;
    assert.ok(s.threshold <= s.count);
  }
  assert.equal(s.count, 3);
  assert.equal(s.threshold, 2);
});
test("rejects invalid, duplicate, overlapping and missing configuration", () => {
  for (const patch of [
    { disabledAttestationSigners: [addr(1)] },
    { attestationSigners: [addr(1), addr(1)] },
    { attestationSigners: [ethers.ZeroAddress, addr(2)] },
    { disabledAttestationSigners: undefined },
    { attestationThreshold: 1 },
    { attestationThreshold: 4 },
    { chainId: Number.MAX_SAFE_INTEGER + 1 },
    { attestationSigners: Array.from({ length: 256 }, (_, i) => addr(i + 20)) },
  ])
    assert.throws(() => normalizeConfig({ ...input(), ...patch }));
});
test("reads one block, checks Safe authority and RPC chain", async () => {
  const config = normalizeConfig(input()),
    blocks = [];
  const iface = new ethers.Interface([
    "function attestationSignerCount() view returns(uint8)",
    "function attestationThreshold() view returns(uint8)",
    "function attestationSigners(address) view returns(bool)",
    "function hasRole(bytes32,address) view returns(bool)",
  ]);
  let authorized = true;
  const provider = {
    getNetwork: async () => ({ chainId: 11155111n }),
    getBlockNumber: async () => 42,
    call: async (tx) => {
      blocks.push(tx.blockTag);
      const p = iface.parseTransaction(tx);
      const v =
        p.name === "attestationSignerCount"
          ? 3
          : p.name === "attestationThreshold"
          ? 2
          : p.name === "hasRole"
          ? authorized
          : p.args[0] !== addr(4);
      return iface.encodeFunctionResult(p.name, [v]);
    },
  };
  assert.equal((await readState(config, provider)).count, 3);
  assert.ok(blocks.every((b) => b === 42));
  authorized = false;
  await assert.rejects(readState(config, provider), /lacks/);
  await assert.rejects(
    readState(config, { getNetwork: async () => ({ chainId: 1n }) }),
    /chain mismatch/
  );
});

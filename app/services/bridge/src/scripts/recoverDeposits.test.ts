import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import fixtures from "./recoverDeposits.fixtures.json";
import { depositsFromReceipt, parseRecoveryArgs } from "./recoverDeposits";

const ROUTER: Record<number, string> = {
  1: "0xc3be40e5eae865d6d80ec334f009eb1bdd107e1b",
  8453: "0xcca91fb604d365391d602c6d733437425ae8447e",
};

test("groups transaction hashes under the chain they follow", () => {
  const { requests, execute } = parseRecoveryArgs([
    "--chain", "1", "--tx", `0x${"11".repeat(32)}`, "--tx", `0x${"22".repeat(32)}`,
    "--chain", "8453", "--tx", `0x${"33".repeat(32)}`,
    "--execute",
  ]);
  assert.equal(execute, true);
  assert.deepEqual(requests.map((r) => [r.externalChainId, r.txHashes.length]), [[1, 2], [8453, 1]]);
});

test("refuses input it cannot act on safely", () => {
  assert.throws(() => parseRecoveryArgs([]), /Nothing to do/);
  assert.throws(() => parseRecoveryArgs(["--tx", `0x${"11".repeat(32)}`]), /before any --chain/);
  assert.throws(() => parseRecoveryArgs(["--chain", "1", "--tx", "0xnothex"]), /32-byte transaction hash/);
  assert.throws(() => parseRecoveryArgs(["--chain", "abc"]), /needs a chain id/);
  assert.throws(() => parseRecoveryArgs(["--chain", "1", "--yolo"]), /Unknown argument/);
  assert.equal(parseRecoveryArgs(["--chain", "1", "--tx", `0x${"AB".repeat(32)}`]).execute, false);
});

test("rebuilds each missed deposit from its own source receipt", () => {
  for (const f of fixtures) {
    const deposits = depositsFromReceipt(f.receipt, ROUTER[f.chain], f.chain);
    assert.equal(deposits.length, 1, `deposit ${f.id}`);
    const [d] = deposits;
    assert.equal(d.externalTokenAmount, f.expected.amount, `amount of deposit ${f.id}`);
    assert.equal(d.targetStratoToken.toLowerCase(), f.expected.target, `target of deposit ${f.id}`);
    assert.equal(d.externalTxHash, f.tx.toLowerCase(), `tx hash of deposit ${f.id}`);
    assert.equal(d.depositKey, f.tx.toLowerCase(), `single-deposit key of ${f.id}`);
    assert.equal(d.externalChainId, f.chain);
    assert.ok(BigInt(d.depositId) > 0n, `deposit id of ${f.id}`);
    assert.equal(d.action, "0");
    const isEth = f.expected.asset === "ETH";
    assert.equal(d.externalToken === "0x0000000000000000000000000000000000000000", isEth);
  }
});

test("ignores logs from anything but the configured router", () => {
  const f = fixtures[0];
  assert.deepEqual(depositsFromReceipt(f.receipt, "0x000000000000000000000000000000000000dead", f.chain), []);
  assert.deepEqual(depositsFromReceipt({ logs: [] }, ROUTER[f.chain], f.chain), []);
});

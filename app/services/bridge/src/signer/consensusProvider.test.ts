import assert from "node:assert/strict";
import test from "node:test";
import { JsonRpcProvider } from "ethers";
import { ConsensusProvider, validateVerifierRpcUrls } from "./consensusProvider";

const urls = ["https://one.example", "https://two.example"];

test("requires independent HTTPS hosts", () => {
  assert.throws(() => validateVerifierRpcUrls([urls[0]]), /two distinct/);
  assert.throws(() => validateVerifierRpcUrls([urls[0], `${urls[0]}/other-key`]), /two distinct/);
  assert.throws(() => validateVerifierRpcUrls([urls[0], "http://two.example"]), /HTTPS/);
  assert.throws(() => validateVerifierRpcUrls([urls[0], "https://user:password@two.example"]), /credentials/);
  validateVerifierRpcUrls(urls);
});

test("every receipt, trace, state and network read fails closed on disagreement or outage", async (t) => {
  let disagree = false;
  let outage = false;
  const seen = new Set<string>();
  t.mock.method(JsonRpcProvider.prototype, "send", async function (this: JsonRpcProvider, method: string) {
    const url = this._getConnection().url;
    seen.add(url);
    if (outage && url.includes("two")) throw new Error("RPC unavailable");
    if (method === "eth_chainId") return disagree && url.includes("two") ? "0x2" : "0x1";
    const value = disagree && url.includes("two") ? "0xab" : "0xcd";
    if (method === "eth_getTransactionReceipt") return { blockHash: value };
    if (method === "trace_transaction") return [{ type: "call", action: { value } }];
    return { value };
  });
  const provider = new ConsensusProvider(urls);
  try {
    assert.equal((await provider.getNetwork()).chainId, 1n);
    for (const method of ["eth_getTransactionReceipt", "trace_transaction", "eth_call"]) {
      disagree = false;
      assert.ok(await provider.send(method, ["0x123"]));
      assert.equal(seen.size, 2);
      disagree = true;
      await assert.rejects(provider.send(method, ["0x123"]), /disagreement/);
      disagree = false;
      outage = true;
      await assert.rejects(provider.send(method, ["0x123"]), /unavailable/);
      outage = false;
    }
    disagree = true;
    await assert.rejects(provider.getNetwork(), /disagreement/);
    await assert.rejects(provider.send("eth_sendRawTransaction", ["0x123"]), /Unsupported/);
  } finally { provider.destroy(); }
});

test("pins latest reads to the slowest provider head", async (t) => {
  const pinned: unknown[] = [];
  t.mock.method(JsonRpcProvider.prototype, "send", async function (this: JsonRpcProvider, method: string, params: unknown[]) {
    if (method === "eth_blockNumber") return this._getConnection().url.includes("one") ? "0x20" : "0x1f";
    pinned.push(params);
    return "0x1";
  });
  const provider = new ConsensusProvider(urls);
  try {
    assert.equal(await provider.send("eth_blockNumber", []), "0x1f");
    await provider.send("eth_call", [{ to: "0x123" }, "latest"]);
    await provider.send("eth_getBlockByNumber", ["latest", false]);
    assert.deepEqual(pinned, [[{ to: "0x123" }, "0x1f"], [{ to: "0x123" }, "0x1f"], ["0x1f", false], ["0x1f", false]]);
  } finally { provider.destroy(); }
});

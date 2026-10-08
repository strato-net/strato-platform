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
    if (method === "trace_transaction") return [{
      type: "call",
      traceAddress: [],
      action: { callType: "call", value },
      result: {},
    }];
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

test("normalizes trace_transaction and callTracer evidence before consensus", async (t) => {
  let disagree = false;
  t.mock.method(JsonRpcProvider.prototype, "send", async function (
    this: JsonRpcProvider,
    method: string,
  ) {
    const call = {
      type: "CALL",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0x01",
      input: "0x",
      output: "0x",
    };
    if (method === "trace_transaction") {
      if (this._getConnection().url.includes("two")) {
        throw new Error("method not found");
      }
      return [{
        type: "call",
        traceAddress: [],
        action: {
          callType: "call",
          from: call.from,
          to: call.to,
          value: call.value,
          input: call.input,
        },
        result: { output: call.output },
      }];
    }
    if (method === "debug_traceTransaction") {
      return { ...call, value: disagree ? "0x2" : call.value };
    }
    return "0x1";
  });
  const provider = new ConsensusProvider(urls);
  try {
    const traces = await provider.send("trace_transaction", ["0x123"]);
    assert.equal(traces.length, 1);
    assert.equal(traces[0].action.to, "0x2222222222222222222222222222222222222222");
    disagree = true;
    await assert.rejects(
      provider.send("trace_transaction", ["0x123"]),
      /disagreement/,
    );
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

test("compares only security-relevant block fields", async (t) => {
  let changedField: "hash" | "number" | "parentHash" | "timestamp" | undefined;
  t.mock.method(JsonRpcProvider.prototype, "send", async function (this: JsonRpcProvider) {
    const block = {
      hash: "0xabc",
      number: "0x10",
      parentHash: "0xdef",
      timestamp: "0x20",
      optionalMetadata: this._getConnection().url,
    };
    if (changedField && this._getConnection().url.includes("two")) {
      block[changedField] = "0xff";
    }
    return block;
  });
  const provider = new ConsensusProvider(urls);
  try {
    assert.ok(await provider.send("eth_getBlockByNumber", ["0x10", false]));
    for (const field of ["hash", "number", "parentHash", "timestamp"] as const) {
      changedField = field;
      await assert.rejects(
        provider.send("eth_getBlockByNumber", ["0x10", false]),
        /disagreement/,
      );
    }
  } finally { provider.destroy(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import RpcController from "./rpc.controller";
import * as rpcConfig from "../../config/rpc.config";

test("RPC proxy allows deposit gas checks but rejects signing and submission, including mixed batches", async (t) => {
  t.mock.method(rpcConfig, "getRpcUpstream", () => ({ upstream: "https://rpc.example", fallback: "https://fallback.example" }));
  const forwarded: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(init.body as string);
    forwarded.push(payload);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x5208" }) } as Response;
  });
  let status = 0, body: unknown;
  const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { body = value; } };
  const call = (method: string) => ({ jsonrpc: "2.0", id: 1, method, params: [] });
  const proxy = (payload: unknown) => RpcController.proxy(
    { params: { chainId: "11155111" }, body: payload } as any,
    res as any,
    error => { throw error; },
  );
  const depositReads = ["eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_getBlockByNumber", "eth_getBalance", "eth_call"];
  for (const method of depositReads) {
    const payload = call(method);
    await proxy(payload);
    assert.equal(status, 200, method);
    assert.deepEqual(forwarded.at(-1), payload);
  }
  await proxy(depositReads.map(call));
  assert.equal(status, 200);
  const allowedCount = forwarded.length;
  for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "eth_signTypedData_v4", "personal_sign", "wallet_sendCalls"]) {
    for (const payload of [call(method), [call("eth_estimateGas"), call(method)]]) {
      await proxy(payload);
      assert.equal(status, 403, method);
      assert.deepEqual(body, { error: "RPC method not allowed" });
      assert.equal(forwarded.length, allowedCount, "blocked requests never reach the upstream");
    }
  }
});

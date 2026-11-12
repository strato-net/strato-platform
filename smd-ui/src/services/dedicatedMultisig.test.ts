import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDedicatedProtocolCall,
  buildDedicatedProtocolWorkflow,
  buildDedicatedCallPayload,
  canonicalizeSetupSigners,
  dedicatedWalletContractName,
  isUnlimitedTokenApproval,
  normalizeDedicatedArguments,
  parseDedicatedTypedArguments,
} from "./dedicatedMultisig";
import { loadBackendConfig } from "@/lib/env";

const wallet = "efa890674cad5e3a7640bb720c2a70bf3ae76709";
const signer = "fdb36b791a35ba52798bbc46ab066587cb60e032";
const spender = "5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71";

test("dedicated setup signers are canonical and duplicate-free", () => {
  assert.deepEqual(
    canonicalizeSetupSigners([`0x${signer}`, wallet, signer]),
    [wallet, signer].sort()
  );
});

test("dedicated logic calls encode with the logic ABI at the permanent wallet address", () => {
  assert.equal(dedicatedWalletContractName("acceptNomination"), "MultisigLogic");
  assert.equal(dedicatedWalletContractName("executeUpgrade"), "MultisigWallet");
  assert.deepEqual(buildDedicatedCallPayload(dedicatedWalletContractName("acceptNomination"), `0x${wallet}`, "acceptNomination", {}), {
    contractName: "MultisigLogic",
    contractAddress: wallet,
    value: 0,
    method: "acceptNomination",
    args: {},
    metadata: {},
  });
});

test("dedicated issue review flags unlimited approvals", () => {
  assert.equal(isUnlimitedTokenApproval("approve", [spender, String(1n << 256n)]), true);
  assert.equal(isUnlimitedTokenApproval("transfer", [spender, String(1n << 256n)]), false);
});

test("dedicated issue events decode JSON-string argument arrays", () => {
  assert.deepEqual(
    normalizeDedicatedArguments(`["${spender}","100000000000000000001"]`),
    [spender, "100000000000000000001"]
  );
  assert.deepEqual(
    normalizeDedicatedArguments(JSON.stringify([{ type: "address", value: spender }])),
    [spender]
  );
});

test("guided protocol calls preserve exact types and large integers", () => {
  const call = buildDedicatedProtocolCall("v3Increase", {
    target: wallet,
    amount: "100000000000000000001",
    amount2: "2",
    amount3: "0",
    amounts: ["0"],
    tokenId: "9007199254740993",
  }, 1_000);
  assert.deepEqual(call.argumentTypes, [
    "uint256", "uint256", "uint256", "uint256", "uint256", "uint256",
  ]);
  assert.deepEqual(
    call.arguments.map((argument: any) => argument.value),
    ["9007199254740993", "100000000000000000001", 2, 0, 0, 6_049_000]
  );
});

test("pool withdrawal encodes token B minimum before token A minimum", () => {
  const call = buildDedicatedProtocolCall("removeLiquidity", {
    target: wallet,
    amount: "100",
    amount2: "6000001",
    amount3: "18000000000000000001",
  }, 1_000);
  assert.deepEqual(
    call.arguments.map((argument: any) => argument.value),
    [100, 6000001, "18000000000000000001", 6_049_000]
  );
});

test("guided workflows put typed approvals before the action", () => {
  const calls = buildDedicatedProtocolWorkflow("stake", {
    target: wallet,
    validator: signer,
    amount: "100",
  }, [{ token: spender, spender: wallet, amount: "100" }], 1_000);
  assert.deepEqual(calls.map((call) => call.functionName), ["approve", "stake"]);
  assert.deepEqual(calls[0].argumentTypes, ["address", "uint256"]);
});

test("typed argument JSON preserves arrays and integers above 2^53", () => {
  const parsed = parseDedicatedTypedArguments(
    '[{"type":"uint256[]","value":[1,9007199254740993]},{"type":"uint256","value":9007199254740993}]'
  );
  assert.deepEqual(parsed.types, ["uint256[]", "uint256"]);
  assert.deepEqual((parsed.args[0] as any).value, [1, "9007199254740993"]);
  assert.equal((parsed.args[1] as any).value, "9007199254740993");
});

test("backend configuration timeout does not block SMD startup", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { ENV: {}, setTimeout, clearTimeout },
  });
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })) as typeof fetch;
  const started = Date.now();
  try {
    await loadBackendConfig(10);
    assert.ok(Date.now() - started < 1_000, "startup remained blocked after the timeout");
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    globalThis.fetch = originalFetch;
  }
});

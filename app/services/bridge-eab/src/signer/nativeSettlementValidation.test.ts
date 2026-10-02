import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { AbiCoder, Interface, keccak256 } from "ethers";
import * as evidence from "./nativeSettlementValidation";
import { parseNativeSourceRecord } from "./nativeAttestationValidation";
import { verifierFailureDetails } from "../utils/processingIssues";
import { NATIVE_MINT_EVENT_ABI, NATIVE_CANCELLATION_ABI, NATIVE_REFUND_ABI } from "../config/bridgeAbi";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const normalize = (value: string) => value.toLowerCase().replace(/^0x/, "");
const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`;
const sourceChainId = 9007199254740993123n;
const sourceBridge = address("1"), externalBridge = address("2");
const representationToken = address("3"), stratoToken = address("4"), recipient = address("5");
const mintId = keccak256(AbiCoder.defaultAbiCoder().encode(
  ["uint256", "address", "uint256"], [sourceChainId, sourceBridge, 7],
));
const event = (abi: readonly string[], name: string, args: any[]) => {
  const iface = new Interface(abi);
  return { address: externalBridge, ...iface.encodeEventLog(iface.getEvent(name)!, args) };
};

// Execute the real native route registrations and RPC adapter. Only transport,
// source reads and STRATO submission are replaced; evidence validation is real.
const source = readFileSync(join(__dirname, "../../src/signer/index.ts"), "utf8");
const code = source.slice(source.indexOf("const assertNativeEvidenceChain"), source.indexOf("const nativePolicyPath")) +
  source.slice(source.indexOf("const getNativeSourceRecord"), source.indexOf('for (const action of ["sign", "attest"]'));
function harness(kind: "withdrawal" | "cancellation" | "deposit" | "refund") {
  const row: any = kind === "withdrawal" || kind === "cancellation" ? {
    bridgeStatus: kind === "withdrawal" ? "2" : "10", cancellationTxHash: hash,
    externalChainId: "11155111", externalBridge, representationToken, stratoToken,
    externalRecipient: recipient, externalTokenAmount: "100",
  } : {
    depositId: "native:7", bridgeStatus: kind === "deposit" ? "1" : "7",
    externalChainId: "11155111", externalBridge, representationToken, stratoToken,
    externalRedemptionId: "7", externalSender: recipient, stratoRecipient: recipient,
    externalTxHash: hash, stratoTokenAmount: "100", actionToken: address("0"), minFinalOut: "0",
  };
  const logs = kind === "withdrawal" ? [event(NATIVE_MINT_EVENT_ABI, "RepresentationMinted",
    [sourceChainId, sourceBridge, 7, stratoToken, representationToken, recipient, 100, mintId])] :
    kind === "cancellation" ? [event(NATIVE_CANCELLATION_ABI, "NativeMintCanceled", [mintId, sourceChainId, sourceBridge, 7])] :
    kind === "refund" ? [event(NATIVE_REFUND_ABI, "RedemptionRefunded", [7, representationToken, recipient, 100])] :
    [event(["event RedemptionRequested(address indexed representationToken,uint256 amount,address indexed sender,address indexed stratoRecipient,uint96 redemptionId)"],
      "RedemptionRequested", [representationToken, 100, recipient, recipient, 7])];
  const state = { row, head: 112, receipt: { blockNumber: "0x64", blockHash, transactionHash: hash, status: "0x1", logs },
    canonicalHash: blockHash, disagreement: false, calls: [] as string[], submissions: [] as any[] };
  const handlers = new Map<string, Function>();
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    ...evidence, parseNativeSourceRecord, verifierFailureDetails, normalize,
    destinationChainId: 11155111n, verifierConfirmations: 12,
    nativeVerifier: { sourceBridge, digest: "policy", policy: {
      sourceChainId: sourceChainId.toString(), destinationChainId: "11155111", destinationBridge: externalBridge,
      version: "1", routes: [{ representationToken, stratoToken }],
    } },
    verifierPolicy: { version: "1" }, verifierPolicyDigest: "policy", settlementAttestorAddress: address("6"),
    provider: { send: async (method: string) => {
      state.calls.push(method);
      if (state.disagreement) throw new Error("Verifier RPC disagreement");
      if (method === "eth_blockNumber") return `0x${state.head.toString(16)}`;
      if (method === "eth_getTransactionReceipt") return state.receipt;
      if (method === "eth_getBlockByNumber") return { hash: state.canonicalHash };
      throw new Error(`Unexpected RPC ${method}`);
    } },
    stratoGet: async (_path: string, params: any) => {
      assert.equal(params.select, "key,value");
      return { data: [{ key: params.key.slice(3), value: state.row }] };
    },
    readSourceDigest: async () => hash,
    submitStratoAttestation: async (...args: any[]) => { state.submissions.push(args); return hash; },
    app: { post: (path: string, handler: Function) => handlers.set(path, handler) },
  });
  return { state, invoke: async () => {
    let status = 200, body: any;
    const response = { status: (value: number) => { status = value; return response; }, json: (value: any) => { body = value; } };
    await handlers.get(`/v1/attest-native-${kind}`)!({ body: {
      withdrawalId: "7", depositId: "native:7", externalTxHash: hash, cancellationTxHash: hash, refundTxHash: hash,
    } }, response);
    return { status, body };
  } };
}

test("native evidence imports without operator runtime credentials or configuration", () => {
  const result = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(join(__dirname, "nativeSettlementValidation.js"))})`],
    { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("the verifier entry point validates verifier configuration without loading runtime credentials", () => {
  const result = spawnSync(process.execPath, [join(__dirname, "index.js")],
    { env: { PATH: process.env.PATH }, cwd: tmpdir(), encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DESTINATION_CHAIN_ID is required/);
  assert.doesNotMatch(result.stderr, /initializing the config|RELAYER_|SAFE_PROPOSER/);
});

test("Cirrus withdrawal identity comes from the selected mapping key", () => {
  assert.equal(parseNativeSourceRecord("withdrawals", "7", [{ key: "7", value: { withdrawalId: "wrong" } }]).withdrawalId, "7");
  for (const rows of [[], [{ key: "8", value: {} }], [{ key: "7" }]]) {
    assert.throws(() => parseNativeSourceRecord("withdrawals", "7", rows), /unavailable/);
  }
});

for (const kind of ["withdrawal", "cancellation", "deposit", "refund"] as const) {
  test(`native ${kind} HTTP handler accepts confirmed evidence without runtime env`, async () => {
    const { state, invoke } = harness(kind);
    assert.equal((await invoke()).status, 200);
    assert.equal(state.submissions.length, 1);
    assert.ok(state.calls.includes("eth_getBlockByNumber"));
  });
  test(`native ${kind} rejects immature, reorged, disputed, wrong-chain and wrong-state evidence`, async () => {
    for (const mutate of [
      (s: any) => { s.head = 111; },
      (s: any) => { s.canonicalHash = hash; },
      (s: any) => { s.disagreement = true; },
      (s: any) => { s.row.externalChainId = "1"; },
      (s: any) => { s.row.bridgeStatus = "3"; },
      (s: any) => { s.receipt.transactionHash = blockHash; },
      (s: any) => { s.receipt.status = "0x0"; },
      (s: any) => { s.receipt.logs[0].removed = true; },
      (s: any) => { s.receipt.logs[0].address = address("9"); },
    ]) {
      const { state, invoke } = harness(kind);
      mutate(state);
      assert.equal((await invoke()).status, 422);
      assert.equal(state.submissions.length, 0);
    }
  });
}

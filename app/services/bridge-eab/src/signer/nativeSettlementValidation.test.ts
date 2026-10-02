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
import { parseNativeSourceRecord, validateNativeRedemptionRefund } from "./nativeAttestationValidation";
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
  source.slice(source.indexOf('app.post("/v1/sign-native-mint"'), source.indexOf('for (const action of ["sign", "attest"]'));
function harness(kind: "withdrawal" | "cancellation" | "deposit" | "refund" | "refund-signing") {
  const row: any = kind === "withdrawal" || kind === "cancellation" ? {
    bridgeStatus: kind === "withdrawal" ? "2" : "10", cancellationTxHash: hash,
    externalChainId: "11155111", externalBridge, representationToken, stratoToken,
    externalRecipient: recipient, externalTokenAmount: "100",
  } : {
    depositId: "a".repeat(64), bridgeStatus: kind === "deposit" ? "1" : "7",
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
    ...evidence, parseNativeSourceRecord, validateNativeRedemptionRefund, verifierFailureDetails, normalize,
    nativeStratoNodeUrl: "https://native.example", auditDecision: () => {}, NATIVE_REFUND_TYPES: {},
    destinationChainId: 11155111n, verifierConfirmations: 12,
    nativeVerifier: { sourceBridge, destinationBridge: externalBridge, digest: "policy",
      bridge: { maxAttestationValiditySeconds: async () => 300n, signerSetVersion: async () => 1n, refundedRedemptions: async () => false },
      signer: { signTypedData: async () => { state.submissions.push("signature"); return hash; } }, policy: {
      sourceBridge: normalize(sourceBridge),
      sourceChainId: sourceChainId.toString(), destinationChainId: "11155111", destinationBridge: externalBridge,
      version: "1", routes: [{ representationToken, stratoToken: normalize(stratoToken) }],
    } },
    verifierPolicy: { version: "1" }, verifierPolicyDigest: "policy", settlementAttestorAddress: address("6"),
    provider: { getBlock: async () => ({ timestamp: 1000 }), send: async (method: string) => {
      state.calls.push(method);
      if (state.disagreement) throw new Error("Verifier RPC disagreement");
      if (method === "eth_blockNumber") return `0x${state.head.toString(16)}`;
      if (method === "eth_getTransactionReceipt") return state.receipt;
      if (method === "eth_getBlockByNumber") return { hash: state.canonicalHash };
      throw new Error(`Unexpected RPC ${method}`);
    } },
    nativeStratoGet: async (_path: string, params: any) => {
      assert.ok(["key,value", "value"].includes(params.select));
      return { data: [{ key: params.key.slice(3), value: state.row }] };
    },
    readSourceDigest: async () => hash,
    submitStratoAttestation: async (...args: any[]) => { assert.equal(args[4], "https://native.example"); state.submissions.push(args); return hash; },
    app: { post: (path: string, handler: Function) => handlers.set(path, handler) },
  });
  return { state, invoke: async () => {
    let status = 200, body: any;
    const response = { status: (value: number) => { status = value; return response; }, json: (value: any) => { body = value; } };
    await handlers.get(kind === "refund-signing" ? "/v1/sign-native-refund" : `/v1/attest-native-${kind}`)!({ body: {
      withdrawalId: "7", depositId: "a".repeat(64), refund: {
        sourceChainId: sourceChainId.toString(), sourceBridge, destinationChainId: "11155111", destinationBridge: externalBridge,
        redemptionId: "7", representationToken, recipient, amount: "100", deadline: "1100", signerSetVersion: "1",
      }, externalTxHash: hash, cancellationTxHash: hash, refundTxHash: hash,
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

for (const kind of ["withdrawal", "cancellation", "deposit", "refund", "refund-signing"] as const) {
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

test("native and EAB source transports keep reads, digest calls and submissions on their selected nodes", async () => {
  const calls: string[] = [];
  const transport = source.slice(source.indexOf("const stratoGet ="), source.indexOf("const getDepositChainConfig"));
  const api: any = {};
  runInNewContext(ts.transpileModule(transport + "\nObject.assign(api, { stratoGet, nativeStratoGet, readSourceDigest, submitStratoAttestation });", {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    api, stratoNodeUrl: "https://eab.example", nativeStratoNodeUrl: "https://native.example", sourceBridge,
    getStratoToken: async () => "fixture", authHeaders: () => ({}), stratoToken: undefined,
    buildBridgeDigestRequest: () => ({}), parseBridgeDigest: () => hash,
    setTimeout: (callback: Function) => callback(),
    axios: {
      get: async (url: string) => { calls.push(url); return { data: [] }; },
      post: async (url: string) => {
        calls.push(url);
        return { data: [{ hash, status: url.includes("/transaction/parallel") ? "Pending" : "Success" }] };
      },
    },
  });
  for (const native of [false, true]) {
    calls.length = 0;
    const url = native ? "https://native.example" : "https://eab.example";
    await (native ? api.nativeStratoGet : api.stratoGet)("/cirrus/search/test", {});
    await api.readSourceDigest("digest", [], sourceBridge, native ? url : undefined);
    await api.submitStratoAttestation("attest", {}, native ? "StratoNativeBridge" : "ExternalAssetBridge", sourceBridge, native ? url : undefined);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((call) => call.startsWith(url + "/")), calls.join(","));
  }
});

test("native executor role validation rejects every privileged role and missing Safe recovery permission", async () => {
  const { NATIVE_EXECUTOR_FORBIDDEN_BRIDGE_ROLES, NATIVE_EXECUTOR_FORBIDDEN_TOKEN_ROLES } = await import("../config/bridgeAbi");
  const { id, ZeroHash } = await import("ethers");
  const validator = readFileSync(join(__dirname, "../../src/utils/configValidator.ts"), "utf8");
  const fragment = validator.slice(validator.indexOf("export const validateNativeExecutorRoles"), validator.indexOf("const EXTERNAL_VAULT_ABI"));
  const roles = { bridge: "", token: "", missingSafe: "", missingTokenBridge: false };
  const executor = address("6"), safe = address("7");
  const roleId = (role: string) => role === "DEFAULT_ADMIN_ROLE" ? ZeroHash : id(role);
  const context: any = { exports: {}, id, ZeroHash, NATIVE_EXECUTOR_FORBIDDEN_BRIDGE_ROLES, NATIVE_EXECUTOR_FORBIDDEN_TOKEN_ROLES,
    isAddress: () => true, ensureHexPrefix: (v: string) => v,
    Contract: class {
      async hasRole(role: string, account: string) {
        return account === executor ? role === roleId(roles.token || "none") : !roles.missingTokenBridge;
      }
    },
  };
  runInNewContext(ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const bridge = {
    getAddress: async () => externalBridge,
    hasRole: async (role: string, account: string) => account === executor
      ? role === roleId(roles.bridge || "none") : role !== roleId(roles.missingSafe || "none"),
  };
  const validate = () => context.exports.validateNativeExecutorRoles(bridge, {}, executor, safe, [representationToken]);
  await validate();
  for (const role of NATIVE_EXECUTOR_FORBIDDEN_BRIDGE_ROLES) {
    roles.bridge = role;
    await assert.rejects(validate(), /must not hold bridge/);
  }
  roles.bridge = "";
  for (const role of NATIVE_EXECUTOR_FORBIDDEN_TOKEN_ROLES) {
    roles.token = role;
    await assert.rejects(validate(), /must not hold token/);
  }
  roles.token = "";
  for (const role of ["DEFAULT_ADMIN_ROLE", "MINT_CANCELLER_ROLE"]) {
    roles.missingSafe = role;
    await assert.rejects(validate(), /Native Safe must hold/);
  }
  roles.missingSafe = "";
  roles.missingTokenBridge = true;
  await assert.rejects(validate(), /lacks token BRIDGE_ROLE/);
});

test("native refund signing rejects forged burn amounts, senders, tokens and redemption identities", async () => {
  const abi = ["event RedemptionRequested(address indexed representationToken,uint256 amount,address indexed sender,address indexed stratoRecipient,uint96 redemptionId)"];
  for (const args of [
    [representationToken, 101, recipient, recipient, 7],
    [representationToken, 100, address("9"), recipient, 7],
    [address("9"), 100, recipient, recipient, 7],
    [representationToken, 100, recipient, recipient, 8],
    [representationToken, 100, recipient, address("9"), 7],
  ]) {
    const { state, invoke } = harness("refund-signing");
    state.receipt.logs = [event(abi, "RedemptionRequested", args)];
    assert.equal((await invoke()).status, 422);
    assert.equal(state.submissions.length, 0);
  }
  const { state, invoke } = harness("refund-signing");
  state.row.stratoToken = address("9");
  assert.equal((await invoke()).status, 422);
  assert.equal(state.submissions.length, 0);
});

test("native instant execution uses KMS and rejects missing custody configuration or manual lanes", async () => {
  const service = readFileSync(join(__dirname, "../../src/services/nativeMintService.ts"), "utf8");
  const fragment = service.slice(service.indexOf("export const executeNativeMint"), service.indexOf("export const getExistingNativeMintTxHash"));
  const kms = { address: address("6"), keyId: "arn:aws:kms:region:account:key/test", region: "region" };
  const state = { configured: true, signed: 0, submitted: 0 };
  class Kms {
    constructor(config: unknown, provider: unknown) { assert.equal(config, kms); assert.ok(provider); }
  }
  const context: any = { exports: {},
    normalizeAttestation: (a: any) => a,
    getNativeMintExecutorKmsConfig: () => state.configured ? kms : undefined,
    signNativeMintAttestation: async () => { state.signed++; return [hash]; },
    getChainRpcUrl: () => "https://fixture.example", JsonRpcProvider: class {}, DigestKmsSigner: Kms,
    NATIVE_MINT_ABI: [],
    Contract: class {
      constructor(_address: unknown, _abi: unknown, signer: unknown) { assert.ok(signer instanceof Kms); }
      async mintRepresentationWithAttestationV2() {
        state.submitted++;
        return { hash, wait: async () => ({ hash, status: 1 }) };
      }
    },
  };
  runInNewContext(ts.transpileModule(fragment, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, context);
  const request = { attestation: { destinationChainId: "11155111", useInstantPath: true }, useInstantPath: true };
  assert.equal(await context.exports.executeNativeMint(request), hash);
  assert.equal(state.submitted, 1);
  request.attestation.useInstantPath = false;
  await assert.rejects(context.exports.executeNativeMint(request), /instant withdrawal/);
  state.configured = false;
  await assert.rejects(context.exports.executeNativeMint(request), /KMS is not configured/);
  assert.equal(state.signed, 1);
  assert.equal(state.submitted, 1);
});

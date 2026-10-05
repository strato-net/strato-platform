import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, JsonRpcProvider, keccak256 } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { DEPOSIT_REFUND_ABI, DEPOSIT_REFUND_TYPES } from "../config/bridgeAbi";
import { validateDepositRefundSource, validateDepositRefundEvidence, validateDepositRefundCompletion } from "./depositRefundValidation";
import type { DepositRefundAuthorization } from "../types";
import type { DepositSettlementAttestation } from "./settlementValidation";

const addr = (s: string) => `0x${s.repeat(40)}`;
const hash = `0x${"a".repeat(64)}`, blockHash = `0x${"b".repeat(64)}`;
const a: DepositRefundAuthorization = { sourceChainId: "90071992547409939999", sourceBridge: addr("1"), destinationChainId: "1",
  destinationVault: addr("2"), depositRouter: addr("3"), depositId: "7", token: addr("4"), recipient: addr("5"), amount: "100", deadline: "2000", signerSetVersion: "1" };
const deposit: DepositSettlementAttestation = { externalChainId: "1", depositRouter: a.depositRouter, depositId: "7",
  externalSender: a.recipient, externalToken: a.token, externalTokenAmount: "100", externalTxHash: hash, externalBlockHash: blockHash,
  externalLogIndex: 2, stratoRecipient: addr("6"), stratoToken: addr("7"), action: "4", actionToken: addr("8"), minFinalOut: "90" };
const record = { ...deposit, status: "8" };
const verifySource = (authorization = a, d = deposit, r: any = record, vault = a.destinationVault) =>
  validateDepositRefundSource(authorization, d, r, vault, BigInt(a.sourceChainId), a.sourceBridge, 1n, a.destinationVault);
const iface = new Interface(DEPOSIT_REFUND_ABI);
const refundId = keccak256(AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [a.depositRouter, a.depositId]));
const providerWith = (receipt: any, head = 112) => ({
  getTransactionReceipt: async () => receipt, getBlockNumber: async () => head, getBlock: async () => ({ timestamp: 1000 }),
  call: async ({ data }: any) => {
    const parsed = iface.parseTransaction({ data })!;
    const value: Record<string, any> = { depositRefundId: refundId, refundedDeposits: true, signerSetVersion: 1n, maxAuthorizationValiditySeconds: 1800n };
    return iface.encodeFunctionResult(parsed.name, [value[parsed.name]]);
  },
} as unknown as JsonRpcProvider);

test("refund signing binds immutable source evidence and requires the irreversible decision", () => {
  verifySource();
  for (const status of [undefined, 0, 2, 4, 6, 7]) assert.throws(() => verifySource(a, deposit, { ...record, status }));
  for (const field of ["sourceChainId", "destinationChainId", "depositId", "amount"] as const) assert.throws(() => verifySource({ ...a, [field]: String(BigInt(a[field]) + 1n) }));
  for (const field of ["sourceBridge", "destinationVault", "depositRouter", "token", "recipient"] as const) assert.throws(() => verifySource({ ...a, [field]: addr("9") }));
  for (const field of ["externalSender", "externalToken", "stratoRecipient", "stratoToken"]) assert.throws(() => verifySource(a, deposit, { ...record, [field]: addr("9") }));
  assert.throws(() => verifySource(a, deposit, { ...record, externalTxHash: blockHash }));
  assert.throws(() => verifySource(a, deposit, { ...record, externalTokenAmount: "101" }));
  assert.throws(() => verifySource(a, deposit, record, addr("9")));
});

test("refund signing re-verifies the original routed deposit and actual vault custody", async () => {
  const deposits = new Interface(["event DepositRoutedWithAction(address indexed token,uint256 amount,address indexed sender,address indexed stratoAddress,address targetStratoToken,uint96 depositId,uint8 action,address actionToken,uint256 minFinalOut)"]);
  const transfers = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const transfer = { address: a.token, index: 1, ...transfers.encodeEventLog(transfers.getEvent("Transfer")!, [a.recipient, a.destinationVault, 100]) };
  const event = { address: a.depositRouter, index: 2, ...deposits.encodeEventLog(deposits.getEvent("DepositRoutedWithAction")!, [a.token, 100, a.recipient, deposit.stratoRecipient, deposit.stratoToken, 7, 4, deposit.actionToken, 90]) };
  const receipt = { hash, status: 1, blockHash, blockNumber: 100, logs: [transfer, event] };
  await validateDepositRefundEvidence(providerWith(receipt), a, deposit, 12);
  for (const bad of [{ ...receipt, logs: [event] }, { ...receipt, status: 0 }, { ...receipt, blockHash: hash }]) {
    await assert.rejects(validateDepositRefundEvidence(providerWith(bad), a, deposit, 12));
  }
  await assert.rejects(validateDepositRefundEvidence(providerWith(receipt, 111), a, deposit, 12), (e: any) => e.issues[0].code === "CONFIRMATIONS_PENDING");
  for (const bad of [{ ...a, deadline: "999" }, { ...a, deadline: "2801" }, { ...a, signerSetVersion: "2" }]) {
    await assert.rejects(validateDepositRefundEvidence(providerWith(receipt), bad, deposit, 12), /expired or stale/);
  }
});

test("refund completion requires finality, successful receipt and the exact return event", async () => {
  const values = [refundId, a.depositRouter, 7n, a.token, a.recipient, 100n];
  const event = (fields = values) => ({ address: a.destinationVault, ...iface.encodeEventLog(iface.getEvent("DepositRefunded")!, fields) });
  const receipt = { hash, blockHash, status: 1, blockNumber: 100, logs: [event()] };
  await validateDepositRefundCompletion(providerWith(receipt), a, hash, 12);
  await assert.rejects(validateDepositRefundCompletion(providerWith(receipt, 111), a, hash, 12), (e: any) => e.issues[0].code === "CONFIRMATIONS_PENDING");
  for (let index = 0; index < values.length; index++) {
    const fields = [...values]; fields[index] = index === 0 ? hash : [2, 5].includes(index) ? 999n : addr("9");
    await assert.rejects(validateDepositRefundCompletion(providerWith({ ...receipt, logs: [event(fields)] }), a, hash, 12));
  }
  for (const bad of [null, { ...receipt, status: 0 }, { ...receipt, hash: blockHash }, { ...receipt, blockHash: undefined },
    { ...receipt, logs: [] }, { ...receipt, logs: [{ ...event(), removed: true }] }, { ...receipt, logs: [{ ...event(), address: addr("9") }] }]) {
    await assert.rejects(validateDepositRefundCompletion(providerWith(bad), a, hash, 12));
  }
});

test("refund HTTP handlers never sign or attest before source and external verification", async () => {
  const source = ts.createSourceFile("index.ts", readFileSync(resolve(__dirname, "../../src/signer/index.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const statement = source.statements.find(node => ts.isForOfStatement(node) && node.getText(source).includes("-deposit-refund"));
  assert.ok(statement);
  const code = ts.transpileModule(statement.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const handlers = new Map<string, any>();
  let state: any = record, valid = true, signatures = 0, attestations = 0;
  runInNewContext(code, { app: { post: (path: string, handler: any) => handlers.set(path, handler) },
    sourceBridge: a.sourceBridge, sourceChainId: BigInt(a.sourceChainId), destinationChainId: 1n, destinationVault: a.destinationVault,
    normalize: (s: string) => s.replace(/^0x/, ""), provider: {}, verifierConfirmations: 12,
    stratoGet: async (path: string, params: any) => {
      assert.equal(params.limit, "1"); assert.equal(params.key, "eq.1"); assert.equal(params.key3, "eq.7");
      return { data: [{ value: path.endsWith("-deposits") ? state : a.destinationVault }] };
    }, validateDepositRefundSource,
    validateDepositRefundEvidence: async () => { if (!valid) throw new Error("custody unavailable"); },
    validateDepositRefundCompletion: async () => { if (!valid) throw new Error("refund not confirmed"); },
    kmsSigner: { signTypedData: async () => { signatures++; return "signed"; } }, DEPOSIT_REFUND_TYPES,
    authorizationSignerAddress: addr("9"), settlementAttestorAddress: addr("8"), readSourceDigest: async () => hash,
    submitStratoAttestation: async () => { attestations++; return blockHash; }, verifierPolicy: { version: "1" }, verifierPolicyDigest: "digest",
    verifierFailureDetails: () => ({}),
  });
  const request = async (action: string, body = { authorization: a, deposit, refundTxHash: hash }) => {
    let status = 200, payload: any;
    const res = { status: (code: number) => { status = code; return res; }, json: (data: any) => { payload = data; } };
    await handlers.get(`/v1/${action}-deposit-refund`)({ body }, res);
    return { status, payload };
  };
  for (const action of ["sign", "attest"]) {
    state = { ...record, status: "2" }; assert.equal((await request(action)).status, 422);
    state = record; valid = false; assert.equal((await request(action)).status, 422);
    valid = true;
  }
  assert.equal(signatures + attestations, 0);
  assert.equal((await request("sign")).payload.signature, "signed");
  assert.equal((await request("attest")).payload.transactionHash, blockHash);
  assert.equal(signatures, 1); assert.equal(attestations, 1);
});

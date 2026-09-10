import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;

async function worker() {
  const phase = process.argv[3];
  const file = process.argv[4];
  const state = JSON.parse(readFileSync(file, "utf8"));
  const persist = () => writeFileSync(file, JSON.stringify(state));
  for (const name of [
    "ALCHEMY_API_KEY", "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID",
    "OPENID_DISCOVERY_URL", "BRIDGE_ADDRESS", "EXTERNAL_ASSET_BRIDGE_ADDRESS",
    "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS",
    "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION", "RELAYER_BA_USERNAME",
    "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_ID", "RELAYER_CLIENT_SECRET",
    "RELAYER_OPENID_DISCOVERY_URL", "STRATO_NODE_URL", "VAULT_PROXY_ADDRESS",
    "VOUCHER_CONTRACT_ADDRESS",
  ]) process.env[name] = "1".repeat(40);
  process.env.SENDGRID_API_KEY = "SG.test.test";
  process.env.CHAIN_1_RPC_URL = "https://rpc.invalid";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS = address("9");
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID = "test-key";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION = "us-east-1";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = "https://one.invalid,https://two.invalid";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = "one,two";

  const { Interface, JsonRpcProvider } = await import("ethers");
  const api = await import("../utils/api");
  const strato = await import("../utils/stratoHelper");
  const { DigestKmsSigner } = await import("../utils/kmsSigner");
  const axios = (await import("axios")).default;
  const { validateWithdrawalRelease } = await import("../signer/settlementValidation");
  const vault = await import("./externalWithdrawalService");
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const { processExternalWithdrawal } = await import("./bridgeService");
  const authorization = {
    sourceChainId: "9001", sourceBridge: address("1"), sourceWithdrawalId: "7",
    destinationChainId: "1", destinationVault: address("2"), token: address("3"),
    recipient: address("4"), amount: "100", notBefore: "1000", deadline: "1100", signerSetVersion: "1",
  };
  const reservationId = vault.getReservationId(authorization);
  const iface = new Interface([
    "function maxAuthorizationValiditySeconds() view returns (uint256)",
    "function signerSetVersion() view returns (uint256)",
    "function reservations(bytes32) view returns (uint8,address,address,uint256,uint256,bytes32)",
    "function release(bytes32)",
    "event WithdrawalReserved(bytes32 indexed reservationId,bytes32 indexed authorizationDigest,uint256 indexed sourceWithdrawalId,address token,address recipient,uint256 amount,uint256 deadline)",
    "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
  ]);
  const releaseLog = {
    ...iface.encodeEventLog(iface.getEvent("WithdrawalReleased")!, [reservationId, address("3"), address("4"), 100]),
    address: address("2"), transactionHash: hash("b"), blockNumber: 105,
  };
  // Only chain and transport boundaries are simulated; recovery services run unchanged.
  (JsonRpcProvider.prototype as any).call = async (tx: any) => {
    assert.equal(String(tx.to).toLowerCase(), address("2"), "use original vault after configuration changes");
    const call = iface.parseTransaction(tx)!;
    if (call.name === "maxAuthorizationValiditySeconds") return iface.encodeFunctionResult(call.name, [100]);
    if (call.name === "signerSetVersion") return iface.encodeFunctionResult(call.name, [phase === "release" ? 1 : 9]);
    assert.equal(call.name, "reservations");
    assert.equal(call.args[0], reservationId);
    return iface.encodeFunctionResult(call.name, [state.vaultStatus, address("3"), address("4"), 100, 1100, hash("d")]);
  };
  (JsonRpcProvider.prototype as any).getBlock = async (tag: any) => {
    const number = tag === "latest" ? (phase === "release" ? 105 : 120) : Number(tag);
    return { number, timestamp: number * 10 };
  };
  (JsonRpcProvider.prototype as any).getBlockNumber = async () => phase === "unconfirmed" ? 106 : 120;
  (JsonRpcProvider.prototype as any).getLogs = async (filter: any) => {
    assert.equal(filter.address, address("2"));
    assert.equal(filter.topics[1], reservationId);
    const released = filter.topics[0] === iface.getEvent("WithdrawalReleased")!.topicHash;
    const block = released ? 105 : 101;
    state.recoveredEvents.push(released ? "release" : "reservation");
    persist();
    return filter.fromBlock <= block && filter.toBlock >= block
      ? [{ transactionHash: released ? hash("b") : hash("a") }] : [];
  };
  (JsonRpcProvider.prototype as any).getTransactionReceipt = async (tx: string) => {
    assert.equal(tx, hash("b"));
    return { status: phase === "failed-receipt" ? 0 : 1, blockNumber: 105,
      logs: phase === "duplicate-event" ? [releaseLog, releaseLog] : [releaseLog] };
  };
  (DigestKmsSigner.prototype as any).sendTransaction = async (tx: any) => {
    assert.equal(phase, "release", "recovery must never pay again");
    assert.equal(iface.parseTransaction(tx)!.name, "release");
    state.vaultStatus = 2;
    state.payments++;
    persist();
    process.exit(73); // Payment committed, but the executor never receives its receipt.
  };
  (api.eth as any).get = async () => ({ networkID: "9001" });
  (api.cirrus as any).get = async (url: string) => {
    url = url.split("?")[0];
    if (url.endsWith("-withdrawals")) return state.completed ? [] : [{ key: "7", value: {
      status: "3", externalChainId: 1, externalToken: address("3"), externalRecipient: address("4"),
      externalTokenAmount: "100", authorizationDeadline: "1100", reservationId: state.reservationId,
      stratoSender: address("5"), stratoToken: address("6"), stratoTokenAmount: "100", requestedAt: "1",
    } }];
    if (url.endsWith("-chains")) return [{ key: "1", value: { enabled: true, vault: address("8") } }];
    if (url.endsWith("-withdrawalAuthorizations")) return [{ key: "7", value: {
      notBefore: "1000", deadline: "1100", signerSetVersion: "1", destinationVault: address("2"),
    } }];
    if (url.endsWith("-settlementVerifiers")) return [{ key: address("7") }, { key: address("8") }];
    if (url.endsWith("BlockApps-ExternalAssetBridge")) return [{ settlementVerifierThreshold: 2, settlementVerifierCount: 2 }];
    assert.ok(url.endsWith("-depositRouters") || url.endsWith("-withdrawalManualReviews"), url);
    return [];
  };
  (strato as any).execute = async (input: any) => {
    assert.equal(input.method, "recordWithdrawalReservation");
    assert.equal(input.args.reservationId, reservationId);
    assert.equal(input.args.reservationTxHash, hash("a"));
    state.reservationId = reservationId;
    persist();
    return { status: "Success" };
  };
  let attestations = 0;
  (axios as any).post = async (url: string, payload: any) => {
    assert.ok(url.endsWith("/v1/attest-release"), "must not request fresh release authorization");
    assert.deepEqual(payload.authorization, authorization);
    assert.equal(payload.reservationId, reservationId);
    await validateWithdrawalRelease(new JsonRpcProvider(), {
      withdrawalId: "7", reservationId, externalTxHash: payload.externalTxHash,
      token: authorization.token, recipient: authorization.recipient, amount: authorization.amount,
    }, authorization.destinationVault, 5);
    attestations++;
    return { data: { transactionHash: hash("c"), settlementAttestor: url.includes("one.invalid") ? address("7") : address("8") } };
  };
  (strato as any).executeAsRelayer = async (input: any) => {
    assert.equal(input.method, "finalizeWithdrawal");
    assert.equal(input.args.externalTxHash, hash("b"));
    assert.equal(attestations, 2);
    assert.equal(state.completed, false);
    state.completed = true;
    state.settlements++;
    persist();
    process.exit(74); // STRATO commits, but the relayer loses the response.
  };
  for (const withdrawal of await getExternalWithdrawalsByStatus("3")) {
    await processExternalWithdrawal(withdrawal);
  }
}

if (process.argv[2] === "--recovery-worker") {
  worker().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
} else {
  test("recovers a paid withdrawal across process crashes without duplicate payment or settlement", () => {
    const directory = mkdtempSync(join(tmpdir(), "withdrawal-recovery-"));
    const file = join(directory, "chain-state.json");
    const read = () => JSON.parse(readFileSync(file, "utf8"));
    const run = (phase: string, expected: number, reason?: string) => {
      const result = spawnSync(process.execPath, [__filename, "--recovery-worker", phase, file], {
        encoding: "utf8", timeout: 30_000, cwd: directory,
      });
      assert.equal(result.status, expected, result.stdout + result.stderr);
      if (reason) assert.ok((result.stdout + result.stderr).includes(reason), result.stdout + result.stderr);
    };
    try {
      writeFileSync(file, JSON.stringify({ vaultStatus: 1, payments: 0, settlements: 0,
        completed: false, reservationId: "", recoveredEvents: [] }));
      run("release", 73);
      assert.equal(read().payments, 1);
      assert.equal(read().settlements, 0);
      for (const [phase, reason] of [
        ["unconfirmed", "insufficient confirmations"],
        ["failed-receipt", "receipt is missing or failed"],
        ["duplicate-event", "event does not match settlement"],
      ]) {
        run(phase, 1, reason);
        assert.equal(read().settlements, 0);
      }
      run("settle", 74);
      run("restart", 0);
      run("restart", 0);
      const result = read();
      assert.equal(result.payments, 1);
      assert.equal(result.settlements, 1);
      assert.equal(result.completed, true);
      assert.ok(result.recoveredEvents.includes("reservation"));
      assert.ok(result.recoveredEvents.includes("release"));
      // An external relayer paid before the source reservation was recorded.
      writeFileSync(file, JSON.stringify({ vaultStatus: 2, payments: 1, settlements: 0,
        completed: false, reservationId: "", recoveredEvents: [] }));
      run("settle", 74);
      run("restart", 0);
      assert.equal(read().payments, 1);
      assert.equal(read().settlements, 1);
      assert.deepEqual(read().recoveredEvents, ["reservation", "release"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

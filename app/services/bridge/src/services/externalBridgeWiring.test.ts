import assert from "node:assert/strict";
import test from "node:test";

for (const name of [
  "ALCHEMY_API_KEY",
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_PRIVATE_KEY",
  "SENDGRID_API_KEY",
  "STRATO_NODE_URL",
  "VAULT_PROXY_ADDRESS",
  "VOUCHER_CONTRACT_ADDRESS",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY = "SG.test.test";

const externalBridgeAddress = process.env.EXTERNAL_ASSET_BRIDGE_ADDRESS!;

test("records non-native deposits on ExternalAssetBridge", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const calls: any[] = [];
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "test" };
  };

  const { depositBatch } = await import("./bridgeService");
  await depositBatch([
    {
      externalChainId: 1,
      externalSender: "sender",
      externalToken: "external-token",
      externalTokenAmount: "100",
      externalTxHash: "transaction",
      stratoRecipient: "recipient",
      targetStratoToken: "strato-token",
    },
  ]);

  assert.deepEqual(calls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "depositBatch",
    args: {
      externalChainIds: [1],
      externalTxHashes: ["transaction"],
      externalTokens: ["external-token"],
      externalTokenAmounts: ["100"],
      stratoRecipients: ["recipient"],
      externalSenders: ["sender"],
      stratoTokens: ["strato-token"],
    },
  });
});

test("reads pending deposits and vault custody from ExternalAssetBridge", async () => {
  const { cirrus } = await import("../utils/api");
  const requestedUrls: string[] = [];
  (cirrus as any).get = async (url: string) => {
    requestedUrls.push(url);
    if (url.includes("-deposits")) {
      return [{
        key: "1",
        key2: "transaction",
        value: {
          status: 1,
          externalToken: "external-token",
          stratoToken: "strato-token",
          stratoRecipient: "recipient",
        },
      }];
    }
    if (url.includes("-routes")) {
      return [{
        key: "external-token",
        key2: "1",
        key3: "strato-token",
        value: {
          depositsEnabled: true,
          externalDecimals: 18,
          externalToken: "external-token",
          stratoToken: "strato-token",
        },
      }];
    }
    if (url.includes("-chains")) {
      return [{
        key: "1",
        value: {
          chainName: "Ethereum",
          depositRouter: "router",
          enabled: true,
          lastProcessedBlock: 10,
          vault: "vault",
        },
      }];
    }
    return [];
  };

  const { getDepositsByStatus } = await import("./cirrusService");
  const deposits = await getDepositsByStatus("1");

  assert.equal(deposits[0].custodyAddress, "vault");
  assert.equal(deposits[0].bridgeStatus, 1);
  assert.ok(
    requestedUrls.every((url) => url.includes("BlockApps-ExternalAssetBridge")),
  );
});

test("reserves and releases before finalizing a routine withdrawal", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (api.eth as any).get = async () => ({ networkID: "9001" });
  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).buildWithdrawalAuthorization = async () => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "7",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "100",
    notBefore: "1000",
    deadline: "2800",
    signerSetVersion: "1",
  });
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 1000n,
  });
  (vaultService as any).reserveWithdrawal = async () => {
    trace.push("vault:reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  };
  (vaultService as any).releaseWithdrawal = async () => {
    trace.push("vault:release");
    return "release-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "1",
    custodyTxHash: "",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
  });

  assert.deepEqual(trace, [
    "strato:markWithdrawalReady",
    "vault:reserve",
    "strato:recordWithdrawalReservation",
    "vault:release",
    "strato:finalizeWithdrawal",
  ]);
});

test("cancels an expired reservation before allowing governance refund", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 1,
    latestTimestamp: 3000n,
    reservationTxHash: "reserve-hash",
  });
  (vaultService as any).cancelExpiredWithdrawal = async () => {
    trace.push("vault:cancel");
    return "cancel-hash";
  };

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  });

  assert.deepEqual(trace, [
    "strato:recordWithdrawalReservation",
    "vault:cancel",
    "strato:recordWithdrawalCancellation",
  ]);
});

test("leaves an expired unreserved withdrawal for governance refund", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).getReservationState = async () => ({
    reservationId: "reservation",
    status: 0,
    latestTimestamp: 3000n,
  });

  const { processExternalWithdrawal } = await import("./bridgeService");
  await processExternalWithdrawal({
    bridgeStatus: "3",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "100",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "100000000000000",
    timestamp: "1",
    withdrawalId: "7",
    vault: "vault",
    authorizationNotBefore: "1000",
    authorizationDeadline: "2800",
    signerSetVersion: "1",
  });

  assert.deepEqual(trace, []);
});

test("restores ready withdrawal authorization state from Cirrus", async () => {
  const { cirrus } = await import("../utils/api");
  (cirrus as any).get = async (url: string) => {
    if (url.includes("-withdrawals")) {
      return [{
        key: "7",
        value: {
          status: 3,
          externalChainId: 1,
          authorizationDeadline: "2800",
        },
      }];
    }
    if (url.includes("-withdrawalAuthorizations")) {
      return [{
        key: "7",
        value: {
          notBefore: "1000",
          deadline: "2800",
          signerSetVersion: "4",
        },
      }];
    }
    if (url.includes("-chains")) {
      return [{
        key: "1",
        value: {
          chainName: "Ethereum",
          depositRouter: "router",
          enabled: true,
          lastProcessedBlock: 10,
          vault: "vault",
        },
      }];
    }
    return [];
  };

  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const withdrawals = await getExternalWithdrawalsByStatus("3");

  assert.equal(withdrawals[0].authorizationNotBefore, "1000");
  assert.equal(withdrawals[0].authorizationDeadline, "2800");
  assert.equal(withdrawals[0].signerSetVersion, "4");
});

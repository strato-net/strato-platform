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
  "SAFE_PROPOSER_KMS_KEY_ID",
  "SAFE_PROPOSER_KMS_REGION",
  "RELAYER_BA_USERNAME",
  "RELAYER_BA_PASSWORD",
  "RELAYER_CLIENT_ID",
  "RELAYER_CLIENT_SECRET",
  "RELAYER_OPENID_DISCOVERY_URL",
  "SENDGRID_API_KEY",
  "STRATO_NODE_URL",
  "VAULT_PROXY_ADDRESS",
  "VOUCHER_CONTRACT_ADDRESS",
]) {
  process.env[name] ||= "1111111111111111111111111111111111111111";
}
process.env.SENDGRID_API_KEY = "SG.test.test";

const externalBridgeAddress = process.env.EXTERNAL_ASSET_BRIDGE_ADDRESS!;

test("atomically settles non-native deposits on ExternalAssetBridge", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const settlementAttestationService = await import(
    "./settlementAttestationService"
  );
  const operatorCalls: any[] = [];
  const relayerCalls: any[] = [];
  (settlementAttestationService as any).attestDepositSettlement =
    async () => undefined;
  (settlementAttestationService as any).attestWithdrawalRelease =
    async () => undefined;
  (stratoHelper as any).execute = async (input: any) => {
    operatorCalls.push(input);
    return { status: "Success", hash: "test" };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    relayerCalls.push(input);
    return { status: "Success", hash: "test" };
  };

  const { settleDeposit } = await import("./bridgeService");
  await settleDeposit({
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  });

  assert.equal(
    operatorCalls.some((call) => call.method === "settleDeposit"),
    false,
  );
  assert.deepEqual(relayerCalls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "settleDeposit",
    args: {
      externalChainId: 1,
      depositRouter: "router",
      depositId: "7",
      externalSender: "sender",
      externalToken: "external-token",
      externalTokenAmount: "100",
      externalTxHash: "transaction",
      stratoRecipient: "recipient",
      stratoToken: "strato-token",
      action: "0",
      actionToken: "0000000000000000000000000000000000000000",
      minFinalOut: "0",
      attestationProof: "0x",
    },
  });
});

test("treats a duplicate identity as settled only when Cirrus confirms completion", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const { cirrus } = await import("../utils/api");
  (stratoHelper as any).execute = async () => {
    throw new Error("EAB: duplicate deposit");
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  const deposit = {
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  };
  const { settleDeposit } = await import("./bridgeService");

  (cirrus as any).get = async () => [{ status: "2" }];
  await assert.rejects(() => settleDeposit(deposit), /not completed/);

  (cirrus as any).get = async () => [{ status: "4" }];
  assert.equal(await settleDeposit(deposit), null);
});

test("confirms reviewed deposits through the bridge operator", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const { cirrus } = await import("../utils/api");
  const cirrusService = await import("./cirrusService");
  const rpcService = await import("./rpcService");
  const verificationService = await import("./verificationService");
  const { depositStateService } = await import("./depositStateService");
  const recovery = await import("./depositRecoveryService");
  const originalRecover = recovery.recoverReviewedDeposit;
  const originalGetEnabledChains = cirrusService.getEnabledChains;
  const originalGetCurrentBlockNumber = rpcService.getCurrentBlockNumber;
  const originalVerifyDetectedDepositsBatch =
    verificationService.verifyDetectedDepositsBatch;
  const originalGetByIdentity = depositStateService.getByIdentity;
  const calls: any[] = [];
  const deposit = {
    externalChainId: 1,
    depositRouter: "router",
    depositId: "7",
    externalSender: "sender",
    externalToken: "external-token",
    externalTokenAmount: "100",
    observedExternalTokenAmount: "100",
    externalTxHash: "transaction",
    externalBlockHash: "block",
    externalBlockNumber: 10,
    externalBlockTimestamp: 1,
    externalLogIndex: 2,
    detectedAt: 1,
    stratoRecipient: "recipient",
    targetStratoToken: "strato-token",
  };
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "confirm-hash" };
  };
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
  (depositStateService as any).getByIdentity = async () => ({
    deposit,
    status: "review",
  });
  (cirrus as any).get = async () => [{ status: "2" }];
  (cirrusService as any).getEnabledChains = async () =>
    new Map([[1, { externalChainId: 1, vault: "vault" }]]);
  (rpcService as any).getCurrentBlockNumber = async () => 20;
  (verificationService as any).verifyDetectedDepositsBatch = async () =>
    new Map([[verificationService.depositIdentity(deposit), { state: "invalid", error: new Error("custody missing") }]]);

  const { confirmReviewedDeposit } = await import("./bridgeService");
  await assert.rejects(
    () => confirmReviewedDeposit(1, "router", "7"),
    /custody missing/,
  );
  assert.equal(calls.length, 0);

  (verificationService as any).verifyDetectedDepositsBatch = async () =>
    new Map([[verificationService.depositIdentity(deposit), { state: "verified" }]]);
  const hash = await confirmReviewedDeposit(1, "router", "7");

  assert.equal(hash, "confirm-hash");
  assert.deepEqual(calls[0], {
    contractName: "ExternalAssetBridge",
    contractAddress: externalBridgeAddress,
    method: "confirmReviewedDeposit",
    args: {
      externalChainId: 1,
      depositRouter: "router",
      depositId: "7",
      attestationProof: "0x",
    },
  });
  let recovered = false;
  (depositStateService as any).getByIdentity = async () => undefined;
  (recovery as any).recoverReviewedDeposit = async (chainId: number, router: string, id: string) => {
    assert.deepEqual([chainId, router, id], [1, "router", "7"]);
    recovered = true;
    return { deposit, status: "review", reviewRecordedOnchain: true };
  };
  assert.equal(await confirmReviewedDeposit(1, "router", "7"), "confirm-hash");
  assert.equal(recovered, true);
  (recovery as any).recoverReviewedDeposit = originalRecover;
  (cirrusService as any).getEnabledChains = originalGetEnabledChains;
  (rpcService as any).getCurrentBlockNumber = originalGetCurrentBlockNumber;
  (verificationService as any).verifyDetectedDepositsBatch =
    originalVerifyDetectedDepositsBatch;
  (depositStateService as any).getByIdentity = originalGetByIdentity;
});

test("isolates a failed settlement from later deposits", async () => {
  const { attemptDepositSettlement } = await import("../polling/alchemyPolling");
  const deposit = {} as any;
  const first = await attemptDepositSettlement(deposit, async () => {
    throw new Error("route disabled");
  });
  let submitted = false;
  const second = await attemptDepositSettlement(deposit, async () => {
    submitted = true;
    return null;
  });

  assert.match(first?.message || "", /route disabled/);
  assert.equal(second, null);
  assert.equal(submitted, true);
});

test("reads pending deposits and vault custody from ExternalAssetBridge", async () => {
  const { cirrus } = await import("../utils/api");
  const requestedUrls: string[] = [];
  (cirrus as any).get = async (url: string) => {
    requestedUrls.push(url);
    if (url.includes("-deposits")) {
      return [{
        key: "1",
        key2: "router",
        key3: "7",
        value: {
          status: 1,
          externalTxHash: "transaction",
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
  assert.equal(deposits[0].depositRouter, "router");
  assert.equal(deposits[0].depositId, "7");
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
    trace.push(`operator:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
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
    "operator:markWithdrawalReady",
    "vault:reserve",
    "operator:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
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
  (stratoHelper as any).executeAsRelayer = (stratoHelper as any).execute;
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

test("queues large withdrawals for Safe review", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const api = await import("../utils/api");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];

  (api.eth as any).get = async () => ({ networkID: "9001" });
  (vaultService as any).buildWithdrawalReview = () => ({ review: true });
  (vaultService as any).proposeWithdrawalReview = async () => ({
    reviewDigest: "0xaaaa",
    approvalDeadline: "9000",
    proposalHash: "0xbbbb",
  });
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "record-review-hash" };
  };

  const { queueExternalWithdrawalReview } = await import("./bridgeService");
  await queueExternalWithdrawalReview({
    bridgeStatus: "1",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
  });

  assert.equal(calls[0].method, "recordWithdrawalReview");
  assert.deepEqual(calls[0].args, {
    withdrawalId: "8",
    reviewDigest: "0xaaaa",
    approvalDeadline: "9000",
    proposalHash: "0xbbbb",
  });
});

test("releases a large withdrawal only after Safe approval", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const trace: string[] = [];

  (nativeMintService as any).getNativeMintProposalExecution = async () => ({
    status: "executed",
    txHash: "approval-hash",
  });
  (vaultService as any).getExternalChainLatestTimestamp = async () => 1000n;
  (stratoHelper as any).execute = async (input: any) => {
    trace.push(`strato:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (stratoHelper as any).executeAsRelayer = async (input: any) => {
    trace.push(`relayer:${input.method}`);
    return { status: "Success", hash: `${input.method}-hash` };
  };
  (vaultService as any).buildWithdrawalAuthorization = async () => ({
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "8",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "501",
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

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.deepEqual(trace, [
    "strato:markWithdrawalReady",
    "vault:reserve",
    "strato:recordWithdrawalReservation",
    "vault:release",
    "relayer:finalizeWithdrawal",
  ]);
});

test("refunds escrow when Safe rejects a large withdrawal", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];

  (nativeMintService as any).getNativeMintProposalExecution = async () => ({
    status: "rejected",
  });
  (vaultService as any).getExternalChainLatestTimestamp = async () => 1000n;
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "rejection-hash" };
  };

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.equal(calls[0].method, "rejectWithdrawalReview");
  assert.deepEqual(calls[0].args, { withdrawalId: "8" });
});

test("expires stale Safe reviews before release authorization", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const nativeMintService = await import("./nativeMintService");
  const vaultService = await import("./externalWithdrawalService");
  const calls: any[] = [];
  let checkedSafe = false;

  (vaultService as any).getExternalChainLatestTimestamp = async () => 9001n;
  (nativeMintService as any).getNativeMintProposalExecution = async () => {
    checkedSafe = true;
    return { status: "executed" };
  };
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "expiry-hash" };
  };

  const { processPendingExternalWithdrawalReview } = await import(
    "./bridgeService"
  );
  await processPendingExternalWithdrawalReview({
    bridgeStatus: "2",
    externalChainId: 1,
    externalRecipient: "recipient",
    externalToken: "token",
    externalTokenAmount: "501",
    requestedAt: "1",
    stratoSender: "sender",
    stratoToken: "strato-token",
    stratoTokenAmount: "501",
    timestamp: "1",
    withdrawalId: "8",
    vault: "vault",
    requiresManualReview: true,
    reviewApprovalDeadline: "9000",
    reviewProposalHash: "0xbbbb",
  });

  assert.equal(checkedSafe, false);
  assert.equal(calls[0].method, "expireWithdrawalReview");
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
    if (url.includes("-withdrawalManualReviews")) {
      return [{
        key: "7",
        value: {
          approvalDeadline: "9000",
          reviewDigest: "0xaaaa",
          proposalHash: "0xbbbb",
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
  assert.equal(withdrawals[0].reviewApprovalDeadline, "9000");
  assert.equal(withdrawals[0].reviewDigest, "0xaaaa");
  assert.equal(withdrawals[0].reviewProposalHash, "0xbbbb");
});

test("collects valid signatures when one signer stalls until the deadline", async () => {
  const { Wallet } = await import("ethers");
  const axios = (await import("axios")).default;
  const signerOne = new Wallet(`0x${"31".repeat(32)}`);
  const signerTwo = new Wallet(`0x${"32".repeat(32)}`);
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS =
    "https://signer-one,https://signer-two,https://signer-three";
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS =
    "token-one,token-two,token-three";

  const authorization = {
    sourceChainId: "9001",
    sourceBridge: "0x1111111111111111111111111111111111111111",
    sourceWithdrawalId: "7",
    destinationChainId: "1",
    destinationVault: "0x2222222222222222222222222222222222222222",
    token: "0x3333333333333333333333333333333333333333",
    recipient: "0x4444444444444444444444444444444444444444",
    amount: "100",
    notBefore: "1000",
    deadline: "1100",
    signerSetVersion: "1",
  };
  const types = {
    WithdrawalAuthorization: [
      { name: "sourceChainId", type: "uint256" },
      { name: "sourceBridge", type: "address" },
      { name: "sourceWithdrawalId", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "destinationVault", type: "address" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "notBefore", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signerSetVersion", type: "uint256" },
    ],
  };
  const originalPost = axios.post;
  const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    assert.equal(milliseconds, 60_000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("verifier deadline exceeded")), 10);
    return controller.signal;
  };
  (axios as any).post = async (url: string, _payload: unknown, options: any) => {
    assert.equal(options.timeout, 60_000);
    if (url.includes("three")) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    const signer = url.includes("one") ? signerOne : signerTwo;
    return {
      data: {
        authorizationSigner: signer.address,
        signature: await signer.signTypedData(
          {
            name: "ExternalBridgeVault",
            version: "1",
            chainId: 1,
            verifyingContract: authorization.destinationVault,
          },
          types,
          authorization,
        ),
      },
    };
  };

  try {
    const { signWithdrawalAuthorization } = await import(
      "./externalWithdrawalService"
    );
    const signatures = await signWithdrawalAuthorization(authorization);
    assert.equal(signatures.length, 2);
  } finally {
    axios.post = originalPost;
    AbortSignal.timeout = originalTimeout;
  }
});

test("requires workload-identity KMS for the external vault executor", async () => {
  const { validateExternalBridgeExecutorConfig } = await import(
    "../utils/configValidator"
  );
  const privateKey = `0x${"44".repeat(32)}`;

  const production = validateExternalBridgeExecutorConfig(
    1,
    undefined,
    privateKey,
    true,
  );
  assert.match(
    production.errors.join("\n"),
    /requires .*KMS_KEY_ID.*KMS_REGION/,
  );

  const development = validateExternalBridgeExecutorConfig(
    1,
    undefined,
    privateKey,
    false,
  );
  assert.match(
    development.errors.join("\n"),
    /requires .*KMS_KEY_ID.*KMS_REGION/,
  );
});

test("validates external vault executor workload-identity KMS config", async () => {
  const { validateExternalBridgeExecutorConfig } = await import(
    "../utils/configValidator"
  );
  const address = "0x5555555555555555555555555555555555555555";

  const incomplete = validateExternalBridgeExecutorConfig(
    1,
    { address, keyId: "", region: "" },
    undefined,
    true,
  );
  assert.match(incomplete.errors.join("\n"), /KMS_KEY_ID/);
  assert.match(incomplete.errors.join("\n"), /KMS_REGION/);

  const complete = validateExternalBridgeExecutorConfig(
    1,
    { address, keyId: "alias/eab-executor", region: "us-east-1" },
    undefined,
    true,
  );
  assert.deepEqual(complete.errors, []);
});

test("requires HTTPS for every external verifier service", async () => {
  const { validateExternalBridgeVerifierUrls } = await import(
    "../utils/configValidator"
  );
  assert.deepEqual(
    validateExternalBridgeVerifierUrls([
      "https://verifier-one.example",
      "https://verifier-two.example",
    ]),
    [],
  );
  assert.match(
    validateExternalBridgeVerifierUrls([
      "http://verifier-one.example",
      "not-a-url",
    ]).join("\n"),
    /must use HTTPS.*Invalid external bridge verifier URL/s,
  );
});

test("isolates disabled-chain withdrawals and resumes them when re-enabled", async () => {
  const { cirrus } = await import("../utils/api");
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const originalGet = cirrus.get;
  let disabledChainEnabled = false;
  let noEnabledChains = false;
  let enrichmentCalls = 0;
  (cirrus as any).get = async (url: string, { params }: any) => {
    if (url.includes("-withdrawals?")) {
      return [1, 2].map((chainId) => ({
        key: String(chainId),
        value: { externalChainId: chainId, status: params["value->>status"].slice(3) },
      }));
    }
    if (url.endsWith("-chains")) {
      assert.equal(params["value->>enabled"], "eq.true");
      return noEnabledChains ? [] : [1, ...(disabledChainEnabled ? [2] : [])].map((chainId) => ({
        key: String(chainId), value: { enabled: true, vault: `vault-${chainId}` },
      }));
    }
    if (url.endsWith("-depositRouters")) return [];
    assert.ok(url.endsWith("-withdrawalAuthorizations") || url.endsWith("-withdrawalManualReviews"));
    enrichmentCalls++;
    assert.equal(params.key, disabledChainEnabled ? "in.(1,2)" : "in.(1)");
    return [];
  };
  try {
    for (const status of ["1", "2", "3"]) {
      const withdrawals = await getExternalWithdrawalsByStatus(status);
      assert.deepEqual(withdrawals.map((row) => [row.withdrawalId, row.vault, row.bridgeStatus]), [
        ["1", "vault-1", status],
      ]);
    }
    disabledChainEnabled = true;
    const resumed = await getExternalWithdrawalsByStatus("3");
    assert.deepEqual(resumed.map((row) => [row.withdrawalId, row.vault]), [
      ["1", "vault-1"], ["2", "vault-2"],
    ]);
    noEnabledChains = true;
    const before = enrichmentCalls;
    assert.deepEqual(await getExternalWithdrawalsByStatus("3"), []);
    assert.equal(enrichmentCalls, before);
  } finally {
    cirrus.get = originalGet;
  }
});

test("recovers withdrawal events in bounded ranges from the authorization time", async () => {
  const { getEventTransactionHash } = await import("./externalWithdrawalService");
  const { Interface } = await import("ethers");
  const vault = `0x${"1".repeat(40)}`;
  const reservationId = `0x${"2".repeat(64)}`;
  const iface = new Interface([
    "event WithdrawalReserved(bytes32 indexed reservationId,bytes32 indexed authorizationDigest,uint256 indexed sourceWithdrawalId,address token,address recipient,uint256 amount,uint256 deadline)",
    "event WithdrawalReleased(bytes32 indexed reservationId,address indexed token,address indexed recipient,uint256 amount)",
    "event WithdrawalCancelled(bytes32 indexed reservationId)",
  ]);
  for (const eventName of ["WithdrawalReserved", "WithdrawalReleased", "WithdrawalCancelled"] as const) {
    const successfulRanges: Array<[number, number]> = [];
    let rejectedRanges = 0;
    const provider = {
      getBlock: async (number: number | string) => {
        const block = number === "latest" ? 5000 : Number(number);
        return { number: block, timestamp: block * 12 };
      },
      getLogs: async (filter: any) => {
        assert.equal(filter.address, vault);
        assert.deepEqual(filter.topics, iface.encodeFilterTopics(eventName, [reservationId]));
        assert.equal(typeof filter.toBlock, "number");
        assert.ok(filter.fromBlock >= 1000);
        if (filter.toBlock - filter.fromBlock + 1 > 200) {
          rejectedRanges++;
          throw new Error("RPC block range limit exceeded");
        }
        successfulRanges.push([filter.fromBlock, filter.toBlock]);
        return filter.fromBlock === 1000 ? [{ transactionHash: "recovered-hash" }] : [];
      },
    } as any;
    assert.equal(await getEventTransactionHash(provider, vault, eventName, reservationId, "12000"), "recovered-hash");
    assert.ok(rejectedRanges > 0);
    assert.equal(successfulRanges[0][1], 5000);
    assert.equal(successfulRanges.at(-1)![0], 1000);
    for (let index = 1; index < successfulRanges.length; index++) {
      assert.equal(successfulRanges[index][1], successfulRanges[index - 1][0] - 1);
    }
    provider.getLogs = async () => [];
    await assert.rejects(getEventTransactionHash(provider, vault, eventName, reservationId, "12000"), /event not found/);
  }
});

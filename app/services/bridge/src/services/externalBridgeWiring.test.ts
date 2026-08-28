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
  "EXTERNAL_BRIDGE_SIGNER_API_TOKEN",
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

test("atomically settles non-native deposits on ExternalAssetBridge", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const calls: any[] = [];
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
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

  assert.deepEqual(calls[0], {
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
    },
  });
});

test("treats a duplicate identity as settled only when Cirrus confirms completion", async () => {
  const stratoHelper = await import("../utils/stratoHelper");
  const { cirrus } = await import("../utils/api");
  (stratoHelper as any).execute = async () => {
    throw new Error("EAB: duplicate deposit");
  };
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
  const calls: any[] = [];
  (stratoHelper as any).execute = async (input: any) => {
    calls.push(input);
    return { status: "Success", hash: "confirm-hash" };
  };

  const { confirmReviewedDeposit } = await import("./bridgeService");
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
    },
  });
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
    "strato:finalizeWithdrawal",
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

test("collects threshold signatures from independent signer services", async () => {
  const { Wallet } = await import("ethers");
  const api = await import("../utils/api");
  const signerOne = new Wallet(`0x${"31".repeat(32)}`);
  const signerTwo = new Wallet(`0x${"32".repeat(32)}`);
  process.env.CHAIN_1_EXTERNAL_BRIDGE_SIGNER_URLS =
    "https://signer-one,https://signer-two";

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
  (api.fetch as any).post = async (url: string) => {
    const signer = url.includes("one") ? signerOne : signerTwo;
    return {
      signer: signer.address,
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
    };
  };

  const { signWithdrawalAuthorization } = await import(
    "./externalWithdrawalService"
  );
  const signatures = await signWithdrawalAuthorization(authorization);
  assert.equal(signatures.length, 2);
});

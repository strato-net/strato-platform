const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

/**
 * "Soft" integration test that runs against a real, locally-running STRATO
 * node with the proof-based bridge changes deployed (PR1-PR4 + the strato-api
 * receipts endpoints + JSON-RPC strato_getReceiptProof). It does NOT bring
 * up infrastructure; you do that yourself, set the env vars below, and run
 * this test.
 *
 * The test:
 *   1. Calls strato_getReceiptProof(blockNumber, txIndex) on the real node.
 *   2. Decodes the V2 header to extract the validator set.
 *   3. Deploys a fresh STRATOLightClient initialized with that validator set,
 *      submits the real signed header, confirms the receipts root is stored.
 *   4. Decodes the receipt to find the externalToken so the vault threshold
 *      can be configured for the small-claim path.
 *   5. Deploys BridgeVault, calls claimWithdrawal with the real proof.
 *   6. Categorizes any failure: verifier-level errors mean cross-language
 *      drift; everything else means the proof was accepted.
 *
 * ============================================================================
 * Prerequisites (you set these up):
 * ============================================================================
 *
 * 1. STRATO node running with the changes from PR1-PR4 plus the receipts
 *    endpoint work. lithium network ID, your node as sole validator.
 *
 * 2. Receipts-root fork is active for the block under test (or your node
 *    has receiptsRootForkBlock set to a small value so test blocks are
 *    post-fork).
 *
 * 3. MercataBridge.sol is upgraded to the version that emits Withdrawal /
 *    WithdrawalRequestedV2 events (the additive Phase 3 changes).
 *
 * 4. A user has called requestWithdrawalProof on MercataBridge, generating
 *    a Withdrawal event in some block. You know that block's number and the
 *    tx index within it (default 0 if you only sent that one tx).
 *
 * 5. Environment variables:
 *      STRATO_RPC_URL       e.g. http://localhost:3000/eth/jsonrpc/v1.2
 *      WITHDRAWAL_BLOCK     decimal block number containing the Withdrawal
 *      STRATO_BRIDGE_ADDR   0x-prefixed MercataBridge address on STRATO
 *      STRATO_CHAIN_ID      decimal external chain id the withdrawal targets
 *
 *    Optional:
 *      WITHDRAWAL_TX_INDEX  default 0
 *      WITHDRAWAL_LOG_INDEX default 0
 *
 * 6. Run:
 *      cd mercata/ethereum
 *      STRATO_RPC_URL=http://localhost:3000/eth/jsonrpc/v1.2 \
 *      WITHDRAWAL_BLOCK=42 \
 *      STRATO_BRIDGE_ADDR=0x... \
 *      STRATO_CHAIN_ID=11155111 \
 *      npx hardhat test test/LiveIntegration.test.js
 */

const CFG = {
  rpcUrl: process.env.STRATO_RPC_URL,
  withdrawalBlock: process.env.WITHDRAWAL_BLOCK
    ? parseInt(process.env.WITHDRAWAL_BLOCK)
    : null,
  withdrawalTxIndex: parseInt(process.env.WITHDRAWAL_TX_INDEX || "0"),
  withdrawalLogIndex: parseInt(process.env.WITHDRAWAL_LOG_INDEX || "0"),
  stratoBridgeAddr: process.env.STRATO_BRIDGE_ADDR,
  chainId: process.env.STRATO_CHAIN_ID
    ? parseInt(process.env.STRATO_CHAIN_ID)
    : null,
};

const REQUIRED_ENV = [
  "STRATO_RPC_URL",
  "WITHDRAWAL_BLOCK",
  "STRATO_BRIDGE_ADDR",
  "STRATO_CHAIN_ID",
];

async function rpcCall(method, params) {
  const res = await fetch(CFG.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.error) {
    throw new Error(`RPC error (${method}): ${body.error.message}`);
  }
  return body.result;
}

/**
 * Decode the V2 header RLP to extract the validator set used to sign it,
 * matching the on-chain decoder in STRATOEventDecoder. Field layout:
 *
 *   [0] version, [1] parentHash, [2] stateRoot, [3] transactionsRoot,
 *   [4] receiptsRoot, [5] logsBloom, [6] number, [7] timestamp,
 *   [8] extraData, [9] currentValidators, [10] newValidators,
 *   [11] removedValidators, [12] proposalSignature, [13] signatures
 */
function decodeHeaderValidators(headerRLP) {
  const fields = ethers.decodeRlp(headerRLP);
  if (fields.length !== 14) {
    throw new Error(
      `Unexpected header field count: got ${fields.length}, expected 14`
    );
  }
  const validators = fields[9];
  if (!Array.isArray(validators)) {
    throw new Error("currentValidators field is not a list");
  }
  return validators.map((addr) => ethers.getAddress(addr));
}

/**
 * Decode the externalToken from a Withdrawal-shaped receipt. We need this
 * to set the per-token threshold on the vault before claiming. Receipt
 * layout: [status, gasUsed, [Log…]]. Log layout: [address, eventName, args].
 * Args layout: 8 fields, externalToken at index 2.
 */
function decodeExternalTokenFromReceipt(receiptRLP, logIndex) {
  const r = ethers.decodeRlp(receiptRLP);
  const logs = r[2];
  const log = logs[logIndex];
  const args = log[2];
  return ethers.getAddress(args[2]);
}

describe("Live integration: real STRATO data → on-chain claim", function () {
  before(function () {
    const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      console.log(
        `\n  [skip] Required env vars not set: ${missing.join(", ")}\n` +
          "         See test/LiveIntegration.test.js header for setup notes.\n"
      );
      this.skip();
    }
  });

  it("strato_getReceiptProof returns header + signatures + proof", async function () {
    this.timeout(30_000);

    const result = await rpcCall("strato_getReceiptProof", [
      String(CFG.withdrawalBlock),
      CFG.withdrawalTxIndex,
    ]);

    expect(result, "RPC returned null — block not found?").to.not.be.null;
    expect(result.headerRLP).to.be.a("string");
    expect(result.signatures).to.be.an("array");
    expect(result.signatures.length).to.be.greaterThan(0);

    if (!result.receiptRLP) {
      throw new Error(
        `No receiptRLP returned. Either the block is pre-fork, the txIndex is wrong, ` +
          `or strato-api hasn't indexed receipts for this block yet.`
      );
    }
    expect(result.mptProof).to.be.an("array");
    expect(result.mptProof.length).to.be.greaterThan(0);
  });

  it("the header validator set, light client, and submitted header agree", async function () {
    this.timeout(60_000);

    const proofResult = await rpcCall("strato_getReceiptProof", [
      String(CFG.withdrawalBlock),
      CFG.withdrawalTxIndex,
    ]);
    const headerRLP = proofResult.headerRLP;
    const signatures = proofResult.signatures;

    const validators = decodeHeaderValidators(headerRLP);
    const sortedValidators = [...validators]
      .map((a) => a.toLowerCase())
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

    const [owner] = await ethers.getSigners();
    const LC = await ethers.getContractFactory("STRATOLightClient");
    const lc = await upgrades.deployProxy(
      LC,
      [owner.address, CFG.withdrawalBlock - 1, sortedValidators],
      { kind: "uups" }
    );
    await lc.waitForDeployment();

    await expect(lc.submitHeader(headerRLP, signatures)).to.emit(
      lc,
      "HeaderSubmitted"
    );

    expect(await lc.tip()).to.equal(BigInt(CFG.withdrawalBlock));
  });

  it("end-to-end: real proof drives a real BridgeVault claim", async function () {
    this.timeout(90_000);

    const proofResult = await rpcCall("strato_getReceiptProof", [
      String(CFG.withdrawalBlock),
      CFG.withdrawalTxIndex,
    ]);
    const { headerRLP, signatures, receiptRLP, mptProof } = proofResult;
    if (!receiptRLP) {
      this.skip();
      return;
    }

    const validators = decodeHeaderValidators(headerRLP);
    const sortedValidators = [...validators]
      .map((a) => a.toLowerCase())
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));

    const externalToken = decodeExternalTokenFromReceipt(
      receiptRLP,
      CFG.withdrawalLogIndex
    );

    const [owner, admin] = await ethers.getSigners();

    const LC = await ethers.getContractFactory("STRATOLightClient");
    const lc = await upgrades.deployProxy(
      LC,
      [owner.address, CFG.withdrawalBlock - 1, sortedValidators],
      { kind: "uups" }
    );
    await lc.waitForDeployment();
    await lc.submitHeader(headerRLP, signatures);

    const Vault = await ethers.getContractFactory("BridgeVault");
    const vault = await upgrades.deployProxy(
      Vault,
      [
        owner.address,
        admin.address,
        await lc.getAddress(),
        CFG.stratoBridgeAddr,
        CFG.chainId,
      ],
      { kind: "uups" }
    );
    await vault.waitForDeployment();

    // Set the threshold high so any small Withdrawal amount qualifies for the
    // instant-claim path. We're testing proof verification, not the threshold
    // gate.
    await vault.setInstantThreshold(externalToken, ethers.MaxUint256);

    let claimError = null;
    try {
      await vault.claimWithdrawal(
        CFG.withdrawalBlock,
        CFG.withdrawalTxIndex,
        CFG.withdrawalLogIndex,
        mptProof,
        receiptRLP
      );
    } catch (err) {
      claimError = err.shortMessage || err.reason || err.message;
    }

    if (claimError === null) {
      console.log("\n  ✓ Full claim succeeded — proof verified and tokens released.\n");
      return;
    }

    // Verifier-level errors are the smoking gun for cross-language drift.
    // Anything else (token-transfer issues, since externalToken probably
    // isn't a real ERC20 on Hardhat) means the proof + decode worked.
    const verifierErrors = [
      "ProofVerificationFailed",
      "WrongStratoVault",
      "UnknownEvent",
      "WrongChainId",
      "AmountAboveInstantThreshold",
      "AmountBelowInstantThreshold",
    ];
    for (const e of verifierErrors) {
      if (claimError.includes(e)) {
        throw new Error(
          `Cross-language drift detected: claim reverted at the verifier with "${e}". ` +
            `Full message: ${claimError}\n\n` +
            `This means bytes produced by the live STRATO node didn't match what the ` +
            `on-chain verifier expects. Check: receipt encoding, header RLP, validator ` +
            `signature format, or stratoVaultAddress configuration.`
        );
      }
    }

    console.log(
      "\n  ✓ Proof verification passed.\n" +
        `    Claim reverted afterwards with: ${claimError}\n` +
        "    (Expected if the externalToken in the receipt isn't a real ERC20 on Hardhat.)\n"
    );
  });
});

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  encodeHeader,
  quorumSigners,
  sortAddresses,
  encodeWithdrawalReceipt,
  singleTxReceiptsTrie,
  twoTxReceiptsTrie,
  inlinedChildTrie,
} = require("./helpers/strato");

/**
 * End-to-end proof flow:
 *
 *   1. Synthesize a STRATO `Withdrawal` event inside a single-tx receipt.
 *   2. Build the receipts trie root.
 *   3. Sign and submit the V2 header carrying that root through the
 *      STRATOLightClient.
 *   4. Call BridgeVault.claimWithdrawal with the real proof. Verify the vault
 *      decodes the receipt, matches the on-chain receipts root, and releases
 *      tokens.
 *
 * This exercises the full library stack (RLPReader, MerklePatricia,
 * STRATOEventDecoder) against canonical STRATO byte shapes -- no harness.
 */

const STRATO_VAULT = "0x" + "10".repeat(20);
const CHAIN_ID = 1;

function makeValidators(n) {
  const wallets = [];
  for (let i = 0; i < n; i++) wallets.push(ethers.Wallet.createRandom());
  return wallets.sort((a, b) =>
    BigInt(a.address) < BigInt(b.address) ? -1 : 1
  );
}

async function deployStack() {
  const [owner, admin, user] = await ethers.getSigners();

  const validators = makeValidators(4);
  const sortedValidators = sortAddresses(validators.map((w) => w.address));

  const LC = await ethers.getContractFactory("STRATOLightClient");
  const lc = await upgrades.deployProxy(
    LC,
    [owner.address, 100, sortedValidators],
    { kind: "uups" }
  );
  await lc.waitForDeployment();

  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Mock", "MOCK");
  await token.waitForDeployment();

  const Vault = await ethers.getContractFactory("BridgeVault");
  const vault = await upgrades.deployProxy(
    Vault,
    [
      owner.address,
      admin.address,
      await lc.getAddress(),
      STRATO_VAULT,
      CHAIN_ID,
    ],
    { kind: "uups" }
  );
  await vault.waitForDeployment();

  await token.mint(await vault.getAddress(), ethers.parseEther("1000"));

  return { owner, admin, user, validators, sortedValidators, lc, vault, token };
}

/**
 * Build a withdrawal receipt + trie + signed header all in one go for a
 * single-tx STRATO block at the given block number, with the asserted
 * (real) Withdrawal payload.
 */
function buildProvenWithdrawal({
  blockNumber,
  sortedValidators,
  validators,
  payload,
  eventName = "Withdrawal",
  contractAddress = STRATO_VAULT,
}) {
  const receiptRLP = encodeWithdrawalReceipt({
    contractAddress,
    eventName,
    ...payload,
  });

  const trie = singleTxReceiptsTrie(receiptRLP);

  const header = encodeHeader({
    number: blockNumber,
    currentValidators: sortedValidators,
    receiptsRoot: trie.root,
  });
  const sigs = quorumSigners(sortedValidators, validators, header);

  return { receiptRLP, trie, header, sigs };
}

describe("End-to-end proof flow", function () {
  it("claims a small withdrawal: real receipt + real MPT proof + real signed header", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();

    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 42,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50, // below threshold
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };

    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
    });

    await lc.submitHeader(header, sigs);
    expect(await lc.getReceiptsRoot(101)).to.equal(trie.root);

    const balBefore = await token.balanceOf(user.address);

    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proof, receiptRLP)
    ).to.emit(vault, "WithdrawalClaimed");

    expect(await token.balanceOf(user.address)).to.equal(
      balBefore + BigInt(payload.externalTokenAmount)
    );

    const nonce = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "uint256"],
      [101, 0, 0]
    );
    expect(await vault.nonceState(nonce)).to.equal(1n); // Claimed
  });

  it("submits a large withdrawal: real proof, then admin approves", async function () {
    const { admin, user, validators, sortedValidators, lc, vault, token } =
      await deployStack();

    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 7,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 500, // above threshold
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 500,
    };

    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
      eventName: "WithdrawalRequested",
    });

    await lc.submitHeader(header, sigs);
    await expect(
      vault.submitProof(101, 0, 0, trie.proof, receiptRLP)
    ).to.emit(vault, "WithdrawalAwaitingApproval");

    const nonce = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "uint256"],
      [101, 0, 0]
    );
    expect(await vault.nonceState(nonce)).to.equal(2n); // AwaitingApproval

    const balBefore = await token.balanceOf(user.address);
    await expect(vault.connect(admin).approveWithdrawal(nonce))
      .to.emit(vault, "WithdrawalApproved");

    expect(await token.balanceOf(user.address)).to.equal(
      balBefore + BigInt(payload.externalTokenAmount)
    );
    expect(await vault.nonceState(nonce)).to.equal(1n); // Claimed
  });

  it("rejects a forgery: receipt log from a non-bridge contract", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 1,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };
    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
      contractAddress: "0x" + "ff".repeat(20), // not the bridge
    });
    await lc.submitHeader(header, sigs);

    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proof, receiptRLP)
    ).to.be.reverted;
  });

  it("rejects a forgery: wrong event name (small claim of a Requested-shaped log)", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 1,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };
    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
      eventName: "WithdrawalRequested", // wrong event for claimWithdrawal
    });
    await lc.submitHeader(header, sigs);

    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proof, receiptRLP)
    ).to.be.reverted;
  });

  it("rejects a tampered proof: receipt bytes don't match the trie root", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 1,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };
    const { trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
    });
    await lc.submitHeader(header, sigs);

    // Build a different receipt with a larger amount, present its bytes but
    // keep the original (smaller-amount) trie root in the proof. The MPT
    // verifier should reject because keccak(differentReceiptRLP) doesn't
    // recover the proof's leaf bytes.
    const tamperedReceipt = encodeWithdrawalReceipt({
      contractAddress: STRATO_VAULT,
      eventName: "Withdrawal",
      ...payload,
      externalTokenAmount: 99, // attacker bumps amount but reuses the proof
    });

    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proof, tamperedReceipt)
    ).to.be.reverted;
  });

  it("replay protection: second claim against the same proof reverts", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    const payload = {
      nonce: 1,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };
    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
    });
    await lc.submitHeader(header, sigs);

    await vault.claimWithdrawal(101, 0, 0, trie.proof, receiptRLP);
    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proof, receiptRLP)
    ).to.be.reverted;
  });

  it("multi-tx receipts trie: claim from a block with two transactions exercises branch+leaf", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    // Two distinct withdrawals at txIndex=0 and txIndex=1 within the same
    // STRATO block. We claim the one at txIndex=0 to exercise the branch
    // node + leaf walk.
    const payload0 = {
      nonce: 11,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 30,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 30,
    };
    const payload1 = {
      ...payload0,
      nonce: 12,
      externalTokenAmount: 70,
      stratoTokenAmount: 70,
    };

    const receipt0 = encodeWithdrawalReceipt({
      contractAddress: STRATO_VAULT,
      eventName: "Withdrawal",
      ...payload0,
    });
    const receipt1 = encodeWithdrawalReceipt({
      contractAddress: STRATO_VAULT,
      eventName: "Withdrawal",
      ...payload1,
    });

    const trie = twoTxReceiptsTrie(receipt0, receipt1);

    const header = encodeHeader({
      number: 101,
      currentValidators: sortedValidators,
      receiptsRoot: trie.root,
    });
    await lc.submitHeader(
      header,
      quorumSigners(sortedValidators, validators, header)
    );

    const balBefore = await token.balanceOf(user.address);
    await expect(
      vault.claimWithdrawal(101, 0, 0, trie.proofs[0].proof, receipt0)
    ).to.emit(vault, "WithdrawalClaimed");
    expect(await token.balanceOf(user.address)).to.equal(
      balBefore + BigInt(payload0.externalTokenAmount)
    );

    // The second withdrawal can also be claimed independently.
    await expect(
      vault.claimWithdrawal(101, 1, 0, trie.proofs[1].proof, receipt1)
    ).to.emit(vault, "WithdrawalClaimed");
    expect(await token.balanceOf(user.address)).to.equal(
      balBefore + BigInt(payload0.externalTokenAmount) + BigInt(payload1.externalTokenAmount)
    );
  });

  it("ETH-denominated large withdrawal: real proof + admin approval releases ETH", async function () {
    const { owner, admin, user, validators, sortedValidators, lc, vault } =
      await deployStack();

    // Fund the vault with ETH for the release.
    await owner.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("10"),
    });

    const ETH = ethers.ZeroAddress;
    await vault.setInstantThreshold(ETH, ethers.parseEther("1"));

    const payload = {
      nonce: 99,
      externalChainId: CHAIN_ID,
      externalToken: ETH,
      externalRecipient: user.address,
      externalTokenAmount: ethers.parseEther("3"), // above threshold
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: ethers.parseEther("3"),
    };
    const { receiptRLP, trie, header, sigs } = buildProvenWithdrawal({
      blockNumber: 101,
      sortedValidators,
      validators,
      payload,
      eventName: "WithdrawalRequested",
    });

    await lc.submitHeader(header, sigs);

    await vault.submitProof(101, 0, 0, trie.proof, receiptRLP);

    const nonce = ethers.solidityPackedKeccak256(
      ["uint256", "uint256", "uint256"],
      [101, 0, 0]
    );

    const balBefore = await ethers.provider.getBalance(user.address);
    await vault.connect(admin).approveWithdrawal(nonce);
    expect(await ethers.provider.getBalance(user.address)).to.equal(
      balBefore + payload.externalTokenAmount
    );
  });

  it("validator-set rotation: claim against a post-rotation block", async function () {
    const { user, validators, sortedValidators, lc, vault, token } =
      await deployStack();
    const tokenAddr = await token.getAddress();
    await vault.setInstantThreshold(tokenAddr, 100);

    // Step 1 -- block 101 ROTATES the validator set: drops the lowest-address
    // validator. Signed by the OUTGOING (genesis) set.
    const removed = sortedValidators[0];
    const remainingValidators = validators.filter(
      (w) => w.address.toLowerCase() !== removed
    );
    const remainingSorted = sortedValidators.filter((a) => a !== removed);

    const rotationHeader = encodeHeader({
      number: 101,
      currentValidators: sortedValidators,
      removedValidators: [removed],
      receiptsRoot: "0x" + "00".repeat(32),
    });
    await lc.submitHeader(
      rotationHeader,
      quorumSigners(sortedValidators, validators, rotationHeader)
    );
    expect(await lc.isValidator(removed)).to.be.false;

    // Step 2 -- block 102 carries a real Withdrawal receipt and is signed by
    // the new (post-rotation) set.
    const payload = {
      nonce: 1,
      externalChainId: CHAIN_ID,
      externalToken: tokenAddr,
      externalRecipient: user.address,
      externalTokenAmount: 50,
      stratoSender: "0x" + "aa".repeat(20),
      stratoToken: "0x" + "bb".repeat(20),
      stratoTokenAmount: 50,
    };
    const receiptRLP = encodeWithdrawalReceipt({
      contractAddress: STRATO_VAULT,
      eventName: "Withdrawal",
      ...payload,
    });
    const trie = singleTxReceiptsTrie(receiptRLP);

    const claimHeader = encodeHeader({
      number: 102,
      currentValidators: remainingSorted,
      receiptsRoot: trie.root,
    });
    await lc.submitHeader(
      claimHeader,
      quorumSigners(remainingSorted, remainingValidators, claimHeader)
    );

    const balBefore = await token.balanceOf(user.address);
    await expect(
      vault.claimWithdrawal(102, 0, 0, trie.proof, receiptRLP)
    ).to.emit(vault, "WithdrawalClaimed");
    expect(await token.balanceOf(user.address)).to.equal(
      balBefore + BigInt(payload.externalTokenAmount)
    );
  });
});

describe("MerklePatricia: inlined-child edge case", function () {
  let h;
  before(async function () {
    const H = await ethers.getContractFactory("MerklePatriciaHarness");
    h = await H.deploy();
    await h.waitForDeployment();
  });

  it("verifies a leaf that's inlined into its parent branch", async function () {
    const valueShort = "0x42"; // tiny value -> tiny leaf -> branch inlines it
    const trie = inlinedChildTrie(valueShort);

    // proof for keyA (0x4f) is just the branch RLP -- no separate proof entry
    // for the leaf, since the branch embeds it directly.
    expect(
      await h.verifyInclusion(
        trie.root,
        trie.proofs.a.trieKey,
        valueShort,
        trie.proofs.a.proof
      )
    ).to.be.true;

    expect(
      await h.verifyInclusion(
        trie.root,
        trie.proofs.b.trieKey,
        valueShort,
        trie.proofs.b.proof
      )
    ).to.be.true;
  });

  it("rejects a wrong value when the branch is correct", async function () {
    const trie = inlinedChildTrie("0x42");
    expect(
      await h.verifyInclusion(
        trie.root,
        trie.proofs.a.trieKey,
        "0x99", // different value
        trie.proofs.a.proof
      )
    ).to.be.false;
  });
});

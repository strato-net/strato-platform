const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

/**
 * Tests for BridgeVault.
 *
 * The proof-verifier path is exercised through a test harness that injects
 * a hand-crafted DecodedWithdrawal (see BridgeVaultHarness.sol). Real proof
 * construction (MPT trie + receipt RLP) is wired in a follow-up pass; these
 * tests focus on the state machine, configuration, threshold gating, and
 * admin separation.
 */

const ZERO_ADDR = ethers.ZeroAddress;
const STRATO_VAULT = "0x1000000000000000000000000000000000001008";
const CHAIN_ID = 1;

const WITHDRAWAL_HASH = ethers.id("Withdrawal");
const WITHDRAWAL_REQUESTED_HASH = ethers.id("WithdrawalRequested");

async function deploy() {
  const [owner, admin, user, relayer] = await ethers.getSigners();

  // Real light client backing the harness so getReceiptsRoot doesn't revert.
  const LC = await ethers.getContractFactory("STRATOLightClient");
  const validators = [];
  for (let i = 0; i < 4; i++) validators.push(ethers.Wallet.createRandom());
  const sortedValidators = validators
    .map((w) => w.address.toLowerCase())
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const lc = await upgrades.deployProxy(
    LC,
    [owner.address, 0, sortedValidators],
    { kind: "uups" }
  );
  await lc.waitForDeployment();

  // Simple ERC20 for testing token release.
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Mock", "MOCK");
  await token.waitForDeployment();

  // Harness vault, initialized with the real light client.
  const Harness = await ethers.getContractFactory("BridgeVaultHarness");
  const vault = await upgrades.deployProxy(
    Harness,
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

  // Fund the vault with tokens and ETH so it can release on claims.
  await token.mint(await vault.getAddress(), ethers.parseEther("1000"));
  await owner.sendTransaction({
    to: await vault.getAddress(),
    value: ethers.parseEther("10"),
  });

  return { owner, admin, user, relayer, vault, token, lc };
}

function makeDecoded(overrides) {
  return {
    contractAddress: STRATO_VAULT,
    eventNameHash: WITHDRAWAL_HASH,
    nonce: 1n,
    externalChainId: BigInt(CHAIN_ID),
    externalToken: ethers.ZeroAddress,
    externalRecipient: ethers.ZeroAddress,
    externalTokenAmount: 0n,
    stratoSender: ethers.ZeroAddress,
    stratoToken: ethers.ZeroAddress,
    stratoTokenAmount: 0n,
    // Defaults align with the vault's nextSeqToProcess starting at 0; tests
    // that submit multiple claims override `seq` explicitly.
    prevWithdrawalBlock: 0n,
    seq: 0n,
    ...overrides,
  };
}

describe("BridgeVault", function () {
  describe("initialize", function () {
    it("reverts on zero owner / admin / lightClient / stratoVault", async function () {
      const [owner] = await ethers.getSigners();
      const Harness = await ethers.getContractFactory("BridgeVaultHarness");
      for (const i of [0, 1, 2, 3]) {
        const args = [owner.address, owner.address, owner.address, owner.address, 1];
        args[i] = ZERO_ADDR;
        await expect(
          upgrades.deployProxy(Harness, args, { kind: "uups" })
        ).to.be.reverted;
      }
    });
  });

  describe("admin configuration", function () {
    it("setInstantThreshold is owner-only and emits event", async function () {
      const { vault, owner, user, token } = await deploy();
      await expect(
        vault.connect(user).setInstantThreshold(await token.getAddress(), 100)
      ).to.be.reverted;

      await expect(
        vault.connect(owner).setInstantThreshold(await token.getAddress(), 100)
      ).to.emit(vault, "InstantThresholdUpdated");
      expect(await vault.instantThreshold(await token.getAddress())).to.equal(100n);
    });

    it("setAdminMultisig rejects zero, otherwise updates", async function () {
      const { vault, owner, user } = await deploy();
      await expect(
        vault.connect(owner).setAdminMultisig(ZERO_ADDR)
      ).to.be.reverted;
      await expect(vault.connect(owner).setAdminMultisig(user.address))
        .to.emit(vault, "AdminMultisigUpdated");
      expect(await vault.adminMultisig()).to.equal(user.address);
    });

    it("pause/unpause toggles the circuit breaker", async function () {
      const { vault, owner } = await deploy();
      await vault.connect(owner).pause();
      expect(await vault.paused()).to.be.true;
      await vault.connect(owner).unpause();
      expect(await vault.paused()).to.be.false;
    });
  });

  describe("claimWithdrawal (small / instant)", function () {
    it("happy path: releases ERC20 to recipient and marks nonce Claimed", async function () {
      const { vault, owner, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const amount = 50n;
      const decoded = makeDecoded({
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: amount,
      });

      await vault.stubProof(1n, 0n, 0n, decoded);

      const balBefore = await token.balanceOf(user.address);
      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x"))
        .to.emit(vault, "WithdrawalClaimed");
      expect(await token.balanceOf(user.address)).to.equal(balBefore + amount);

      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      expect(await vault.nonceState(nonce)).to.equal(1n); // Claimed
    });

    it("releases ETH when externalToken is the zero address", async function () {
      const { vault, user } = await deploy();
      await vault.setInstantThreshold(ZERO_ADDR, ethers.parseEther("5"));

      const amount = ethers.parseEther("1");
      const decoded = makeDecoded({
        externalToken: ZERO_ADDR,
        externalRecipient: user.address,
        externalTokenAmount: amount,
      });
      await vault.stubProof(2n, 0n, 0n, decoded);

      const balBefore = await ethers.provider.getBalance(user.address);
      await vault.claimWithdrawal(2, 0, 0, [], "0x");
      const balAfter = await ethers.provider.getBalance(user.address);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("rejects amount at or above threshold (must use submitProof)", async function () {
      const { vault, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const decoded = makeDecoded({
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 100n, // == threshold, should reject
      });
      await vault.stubProof(1n, 0n, 0n, decoded);

      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });

    it("rejects replay of the same (block, tx, log)", async function () {
      const { vault, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const decoded = makeDecoded({
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 50n,
      });
      await vault.stubProof(1n, 0n, 0n, decoded);

      await vault.claimWithdrawal(1, 0, 0, [], "0x");
      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });

    it("rejects when paused", async function () {
      const { vault, owner, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);
      await vault.connect(owner).pause();

      const decoded = makeDecoded({
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 50n,
      });
      await vault.stubProof(1n, 0n, 0n, decoded);

      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });

    it("rejects wrong source contract address (forgery from a non-bridge contract)", async function () {
      const { vault, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const decoded = makeDecoded({
        contractAddress: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 50n,
      });
      await vault.stubProof(1n, 0n, 0n, decoded);

      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });

    it("rejects wrong event name (a WithdrawalRequested log can't be claimed via small path)", async function () {
      const { vault, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const decoded = makeDecoded({
        eventNameHash: WITHDRAWAL_REQUESTED_HASH, // wrong type for claimWithdrawal
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 50n,
      });
      await vault.stubProof(1n, 0n, 0n, decoded);

      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });

    it("rejects wrong chain id", async function () {
      const { vault, user, token } = await deploy();
      await vault.setInstantThreshold(await token.getAddress(), 100);

      const decoded = makeDecoded({
        externalChainId: 999n,
        externalToken: await token.getAddress(),
        externalRecipient: user.address,
        externalTokenAmount: 50n,
      });
      await vault.stubProof(1n, 0n, 0n, decoded);
      await expect(vault.claimWithdrawal(1, 0, 0, [], "0x")).to.be.reverted;
    });
  });

  describe("submitProof + approveWithdrawal (large / admin-gated)", function () {
    async function setupLarge() {
      const env = await deploy();
      await env.vault.setInstantThreshold(await env.token.getAddress(), 100);

      const amount = 500n; // above threshold
      const decoded = makeDecoded({
        eventNameHash: WITHDRAWAL_REQUESTED_HASH,
        externalToken: await env.token.getAddress(),
        externalRecipient: env.user.address,
        externalTokenAmount: amount,
      });
      await env.vault.stubProof(1n, 0n, 0n, decoded);
      return { ...env, amount };
    }

    it("happy path: submitProof -> AwaitingApproval, then admin approve releases", async function () {
      const { vault, admin, user, token, amount } = await setupLarge();

      await expect(vault.submitProof(1, 0, 0, [], "0x"))
        .to.emit(vault, "WithdrawalAwaitingApproval");

      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      expect(await vault.nonceState(nonce)).to.equal(2n); // AwaitingApproval

      const balBefore = await token.balanceOf(user.address);
      await expect(vault.connect(admin).approveWithdrawal(nonce))
        .to.emit(vault, "WithdrawalApproved")
        .and.to.emit(vault, "WithdrawalClaimed");
      expect(await token.balanceOf(user.address)).to.equal(balBefore + amount);
      expect(await vault.nonceState(nonce)).to.equal(1n); // Claimed
    });

    it("rejectWithdrawal: AwaitingApproval -> Rejected, no funds move", async function () {
      const { vault, admin, user, token } = await setupLarge();

      await vault.submitProof(1, 0, 0, [], "0x");
      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );

      const balBefore = await token.balanceOf(user.address);
      await expect(vault.connect(admin).rejectWithdrawal(nonce, "fraud"))
        .to.emit(vault, "WithdrawalRejected");
      expect(await token.balanceOf(user.address)).to.equal(balBefore);
      expect(await vault.nonceState(nonce)).to.equal(3n); // Rejected
    });

    it("rejects approveWithdrawal from non-admin", async function () {
      const { vault, user } = await setupLarge();
      await vault.submitProof(1, 0, 0, [], "0x");
      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      await expect(vault.connect(user).approveWithdrawal(nonce)).to.be.reverted;
    });

    it("rejects approveWithdrawal on a Claimed nonce", async function () {
      const { vault, admin } = await setupLarge();
      await vault.submitProof(1, 0, 0, [], "0x");
      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      await vault.connect(admin).approveWithdrawal(nonce);
      await expect(vault.connect(admin).approveWithdrawal(nonce)).to.be.reverted;
    });

    it("rejects approveWithdrawal on a Rejected nonce", async function () {
      const { vault, admin } = await setupLarge();
      await vault.submitProof(1, 0, 0, [], "0x");
      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      await vault.connect(admin).rejectWithdrawal(nonce, "fraud");
      await expect(vault.connect(admin).approveWithdrawal(nonce)).to.be.reverted;
    });

    it("rejects rejectWithdrawal from non-admin", async function () {
      const { vault, user } = await setupLarge();
      await vault.submitProof(1, 0, 0, [], "0x");
      const nonce = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256"],
        [1, 0, 0]
      );
      await expect(vault.connect(user).rejectWithdrawal(nonce, "no")).to.be.reverted;
    });

    it("rejects approving an unknown (Unused) nonce", async function () {
      const { vault, admin } = await deploy();
      const fakeNonce = ethers.id("nope");
      await expect(vault.connect(admin).approveWithdrawal(fakeNonce)).to.be.reverted;
    });

    it("rejects submitProof when amount is below threshold", async function () {
      const env = await deploy();
      await env.vault.setInstantThreshold(await env.token.getAddress(), 100);
      const decoded = makeDecoded({
        eventNameHash: WITHDRAWAL_REQUESTED_HASH,
        externalToken: await env.token.getAddress(),
        externalRecipient: env.user.address,
        externalTokenAmount: 50n, // below threshold; should be a Withdrawal not WithdrawalRequested
      });
      await env.vault.stubProof(1n, 0n, 0n, decoded);
      await expect(env.vault.submitProof(1, 0, 0, [], "0x")).to.be.reverted;
    });
  });

  describe("sequence-ordered queue", function () {
    /**
     * Stage `count` claims at consecutive seqs starting from `startSeq`.
     * Each one targets a distinct (block, txIndex) so the (block, txIndex,
     * logIndex)-derived nonce is unique. Returns per-claim metadata so
     * tests can assert on individual nonces.
     */
    async function stageHotClaims(env, startSeq, count, perAmount) {
      const tokenAddr = await env.token.getAddress();
      await env.vault.setInstantThreshold(tokenAddr, 1_000_000n);
      const claims = [];
      for (let i = 0; i < count; i++) {
        const seq = BigInt(startSeq + i);
        const blk = BigInt(100 + i);
        const decoded = makeDecoded({
          externalToken: tokenAddr,
          externalRecipient: env.user.address,
          externalTokenAmount: perAmount,
          seq,
          prevWithdrawalBlock: i === 0 ? 0n : BigInt(100 + i - 1),
        });
        await env.vault.stubProof(blk, 0n, 0n, decoded);
        const nonce = ethers.solidityPackedKeccak256(
          ["uint256", "uint256", "uint256"],
          [blk, 0n, 0n],
        );
        claims.push({ blk, seq, nonce });
      }
      return claims;
    }

    it("releases funds immediately on a valid proof", async function () {
      const env = await deploy();
      const [c0] = await stageHotClaims(env, 0, 1, 50n);

      const balBefore = await env.token.balanceOf(env.user.address);
      await expect(env.vault.claimWithdrawal(c0.blk, 0, 0, [], "0x"))
        .to.emit(env.vault, "WithdrawalClaimed");

      expect(await env.token.balanceOf(env.user.address)).to.equal(balBefore + 50n);
      expect(await env.vault.nonceState(c0.nonce)).to.equal(1n); // Claimed
    });

    it("releases an out-of-order claim immediately instead of queuing it", async function () {
      const env = await deploy();
      const claims = await stageHotClaims(env, 0, 2, 50n);

      const balBefore = await env.token.balanceOf(env.user.address);
      // seq=1 arrives with seq=0 never seen. It must still pay out.
      await expect(env.vault.claimWithdrawal(claims[1].blk, 0, 0, [], "0x"))
        .to.emit(env.vault, "WithdrawalClaimed");

      expect(await env.token.balanceOf(env.user.address)).to.equal(balBefore + 50n);
      expect(await env.vault.nonceState(claims[1].nonce)).to.equal(1n); // Claimed
      // Nothing was parked.
      await expect(env.vault.processQueue(10)).to.be.revertedWithCustomError(
        env.vault,
        "QueueEmpty",
      );
    });

    it("an abandoned earlier withdrawal does not block later ones", async function () {
      // The reason ordering was dropped. STRATO burns at request time and the
      // L1 claim is a separate user-paid step, so a withdrawal worth less than
      // claim gas is rationally abandoned. Under the old order-gated release
      // that froze every later withdrawal on the chain permanently, with no
      // admin override. seq=0 here is never claimed.
      const env = await deploy();
      const claims = await stageHotClaims(env, 0, 4, 50n);

      const balBefore = await env.token.balanceOf(env.user.address);
      for (const i of [3, 1, 2]) {
        await env.vault.claimWithdrawal(claims[i].blk, 0, 0, [], "0x");
      }

      expect(await env.token.balanceOf(env.user.address)).to.equal(balBefore + 150n);
      for (const i of [1, 2, 3]) {
        expect(await env.vault.nonceState(claims[i].nonce)).to.equal(1n); // Claimed
      }
      expect(await env.vault.nonceState(claims[0].nonce)).to.equal(0n); // still Unused
    });

    it("still rejects a replay of an already-claimed withdrawal", async function () {
      const env = await deploy();
      const [c0] = await stageHotClaims(env, 0, 1, 50n);
      await env.vault.claimWithdrawal(c0.blk, 0, 0, [], "0x");
      // Replay protection is the nonce, independent of any sequencing.
      await expect(
        env.vault.claimWithdrawal(c0.blk, 0, 0, [], "0x"),
      ).to.be.revertedWithCustomError(env.vault, "NonceAlreadyConsumed");
    });

    it("processQueue reverts: nothing is ever queued now", async function () {
      const env = await deploy();
      const claims = await stageHotClaims(env, 0, 3, 50n);
      for (let i = 2; i >= 0; i--) {
        await env.vault.claimWithdrawal(claims[i].blk, 0, 0, [], "0x");
      }
      await expect(env.vault.processQueue(10)).to.be.revertedWithCustomError(
        env.vault,
        "QueueEmpty",
      );
    });
  });
});

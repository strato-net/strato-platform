const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ExternalBridgeVault", function () {
  let admin;
  let guardian;
  let signerOne;
  let signerTwo;
  let executor;
  let recipient;
  let other;
  let vault;
  let token;
  let sourceBridge;

  const sourceChainId = 2001n;
  const sourceWithdrawalId = 17n;

  const authorizationTypes = {
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

  async function buildAuthorization(overrides = {}) {
    const network = await ethers.provider.getNetwork();
    const block = await ethers.provider.getBlock("latest");

    return {
      sourceChainId,
      sourceBridge,
      sourceWithdrawalId,
      destinationChainId: network.chainId,
      destinationVault: await vault.getAddress(),
      token: await token.getAddress(),
      recipient: recipient.address,
      amount: 100n,
      notBefore: BigInt(block.timestamp),
      deadline: BigInt(block.timestamp + 30 * 60),
      signerSetVersion: await vault.signerSetVersion(),
      ...overrides,
    };
  }

  async function signAuthorization(signer, authorization) {
    const network = await ethers.provider.getNetwork();
    return signer.signTypedData(
      {
        name: "ExternalBridgeVault",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await vault.getAddress(),
      },
      authorizationTypes,
      authorization,
    );
  }

  async function thresholdSignatures(authorization) {
    const signed = await Promise.all(
      [signerOne, signerTwo].map(async (signer) => ({
        address: signer.address,
        signature: await signAuthorization(signer, authorization),
      })),
    );
    return signed
      .sort((a, b) =>
        a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
      )
      .map(({ signature }) => signature);
  }

  async function reserve(authorization) {
    const signatures = await thresholdSignatures(authorization);
    await vault.connect(executor).reserve(authorization, signatures);
    return vault.getReservationId(
      authorization.sourceChainId,
      authorization.sourceBridge,
      authorization.sourceWithdrawalId,
    );
  }

  beforeEach(async function () {
    [
      admin,
      guardian,
      signerOne,
      signerTwo,
      executor,
      recipient,
      other,
    ] = await ethers.getSigners();

    sourceBridge = ethers.Wallet.createRandom().address;

    const Token = await ethers.getContractFactory("MockDepositToken");
    token = await Token.deploy();
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory("ExternalBridgeVault");
    vault = await upgrades.deployProxy(
      Vault,
      [admin.address, guardian.address],
      { initializer: "initialize" },
    );
    await vault.waitForDeployment();

    await vault.setAttestationSigner(signerOne.address, true);
    await vault.setAttestationSigner(signerTwo.address, true);
    await vault.setAttestationThreshold(2);
    await vault.setSourceBridge(sourceChainId, sourceBridge, true);
    await vault.setTokenPolicy(
      await token.getAddress(),
      true,
      1_000n,
      2_000n,
      24n * 60n * 60n,
      500n,
    );
    await token.mint(await vault.getAddress(), 5_000n);
  });

  it("reserves and releases ERC-20 liquidity with threshold signatures", async function () {
    const authorization = await buildAuthorization();
    const signatures = await thresholdSignatures(authorization);
    const reservationId = await vault.getReservationId(
      sourceChainId,
      sourceBridge,
      sourceWithdrawalId,
    );

    await expect(vault.connect(executor).reserve(authorization, signatures))
      .to.emit(vault, "WithdrawalReserved")
      .withArgs(
        reservationId,
        await vault.authorizationDigest(authorization),
        sourceWithdrawalId,
        await token.getAddress(),
        recipient.address,
        100n,
        authorization.deadline,
      );

    expect(await vault.totalReserved(await token.getAddress())).to.equal(100n);
    expect(await vault.availableLiquidity(await token.getAddress())).to.equal(
      4_900n,
    );

    await expect(vault.connect(other).release(reservationId))
      .to.emit(vault, "WithdrawalReleased")
      .withArgs(
        reservationId,
        await token.getAddress(),
        recipient.address,
        100n,
      );

    expect(await token.balanceOf(recipient.address)).to.equal(100n);
    expect(await vault.totalReserved(await token.getAddress())).to.equal(0n);
    expect((await vault.reservations(reservationId)).status).to.equal(2n);
  });

  it("rejects an authorization without the configured signer threshold", async function () {
    const authorization = await buildAuthorization();
    const signature = await signAuthorization(signerOne, authorization);

    await expect(
      vault.connect(executor).reserve(authorization, [signature]),
    ).to.be.revertedWithCustomError(vault, "InvalidAttestationThreshold");
  });

  it("rejects an authorization signed by an unknown signer", async function () {
    const authorization = await buildAuthorization();
    const signatures = await Promise.all(
      [signerOne, other].map(async (signer) => ({
        address: signer.address,
        signature: await signAuthorization(signer, authorization),
      })),
    );
    signatures.sort((a, b) =>
      a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );

    await expect(
      vault
        .connect(executor)
        .reserve(
          authorization,
          signatures.map(({ signature }) => signature),
        ),
    ).to.be.revertedWithCustomError(vault, "BadAttestationSignatures");
  });

  it("permanently rejects a duplicate withdrawal identity", async function () {
    const authorization = await buildAuthorization();
    const signatures = await thresholdSignatures(authorization);
    await vault.connect(executor).reserve(authorization, signatures);

    await expect(
      vault.connect(executor).reserve(authorization, signatures),
    ).to.be.revertedWithCustomError(vault, "InvalidReservationState");
  });

  it("cancels an expired reservation and prevents release", async function () {
    const authorization = await buildAuthorization();
    const reservationId = await reserve(authorization);

    await expect(
      vault.connect(other).cancelExpired(reservationId),
    ).to.be.revertedWithCustomError(vault, "ReservationNotExpired");

    await time.increaseTo(authorization.deadline + 1n);

    await expect(vault.connect(other).cancelExpired(reservationId))
      .to.emit(vault, "WithdrawalCancelled")
      .withArgs(reservationId);

    expect(await vault.totalReserved(await token.getAddress())).to.equal(0n);
    expect((await vault.reservations(reservationId)).status).to.equal(3n);
    await expect(
      vault.connect(executor).release(reservationId),
    ).to.be.revertedWithCustomError(vault, "InvalidReservationState");
  });

  it("requires Safe review approval above the configured threshold", async function () {
    const authorization = await buildAuthorization({ amount: 501n });
    const signatures = await thresholdSignatures(authorization);

    await expect(
      vault.connect(executor).reserve(authorization, signatures),
    ).to.be.revertedWithCustomError(
      vault,
      "LargeWithdrawalApprovalRequired",
    );

    const digest = await vault.authorizationDigest(authorization);
    await vault.approveLargeWithdrawal(digest, authorization.deadline);
    await expect(vault.connect(executor).reserve(authorization, signatures)).to
      .emit(vault, "WithdrawalReserved");
  });

  it("prevents non-governance accounts from approving large withdrawals", async function () {
    const authorization = await buildAuthorization({ amount: 501n });
    const digest = await vault.authorizationDigest(authorization);

    await expect(
      vault
        .connect(other)
        .approveLargeWithdrawal(digest, authorization.deadline),
    ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
  });

  it("reserves window capacity before external execution", async function () {
    await vault.setTokenPolicy(
      await token.getAddress(),
      true,
      1_000n,
      150n,
      24n * 60n * 60n,
      0n,
    );

    const first = await buildAuthorization({ amount: 100n });
    await reserve(first);

    const second = await buildAuthorization({
      sourceWithdrawalId: sourceWithdrawalId + 1n,
      amount: 51n,
    });
    const signatures = await thresholdSignatures(second);

    await expect(
      vault.connect(executor).reserve(second, signatures),
    ).to.be.revertedWithCustomError(vault, "WindowLimitExceeded");
  });

  it("invalidates unsigned authorizations when the signer set changes", async function () {
    const authorization = await buildAuthorization();
    const signatures = await thresholdSignatures(authorization);

    await vault.setAttestationSigner(other.address, true);

    await expect(
      vault.connect(executor).reserve(authorization, signatures),
    ).to.be.revertedWithCustomError(vault, "StaleSignerSet");
  });

  it("rejects authorizations from an unconfigured STRATO bridge", async function () {
    const authorization = await buildAuthorization({
      sourceBridge: ethers.Wallet.createRandom().address,
    });
    const signatures = await thresholdSignatures(authorization);

    await expect(
      vault.connect(executor).reserve(authorization, signatures),
    ).to.be.revertedWithCustomError(vault, "SourceBridgeDisabled");
  });

  it("allows the guardian to pause but only governance to unpause", async function () {
    await vault.connect(guardian).pause();
    const authorization = await buildAuthorization();
    const signatures = await thresholdSignatures(authorization);

    await expect(
      vault.connect(executor).reserve(authorization, signatures),
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");

    await expect(
      vault.connect(guardian).unpause(),
    ).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");

    await vault.unpause();
    await expect(vault.connect(executor).reserve(authorization, signatures)).to
      .emit(vault, "WithdrawalReserved");
  });

  it("reserves and releases native ETH", async function () {
    await vault.setTokenPolicy(
      ethers.ZeroAddress,
      true,
      ethers.parseEther("2"),
      ethers.parseEther("5"),
      24n * 60n * 60n,
      ethers.parseEther("1"),
    );
    await admin.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("3"),
    });

    const authorization = await buildAuthorization({
      token: ethers.ZeroAddress,
      amount: ethers.parseEther("0.5"),
    });
    const reservationId = await reserve(authorization);
    const balanceBefore = await ethers.provider.getBalance(recipient.address);

    await vault.connect(executor).release(reservationId);

    expect(await ethers.provider.getBalance(recipient.address)).to.equal(
      balanceBefore + ethers.parseEther("0.5"),
    );
  });
});

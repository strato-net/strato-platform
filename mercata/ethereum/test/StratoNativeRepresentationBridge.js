const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("StratoNativeRepresentationBridge", function () {
  let admin;
  let user;
  let stratoRecipient;
  let attestationSigner;
  let otherSigner;
  let bridge;
  let token;
  let stratoToken;
  const sourceChainId = 2001n;
  const sourceWithdrawalId = 17n;
  let sourceBridge;

  const attestationTypes = {
    NativeMintAttestation: [
      { name: "sourceChainId", type: "uint256" },
      { name: "sourceBridge", type: "address" },
      { name: "destinationChainId", type: "uint256" },
      { name: "destinationBridge", type: "address" },
      { name: "sourceWithdrawalId", type: "uint256" },
      { name: "stratoToken", type: "address" },
      { name: "representationToken", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  async function buildAttestation(overrides = {}) {
    const network = await ethers.provider.getNetwork();
    const block = await ethers.provider.getBlock("latest");

    return {
      sourceChainId,
      sourceBridge,
      destinationChainId: network.chainId,
      destinationBridge: await bridge.getAddress(),
      sourceWithdrawalId,
      stratoToken,
      representationToken: await token.getAddress(),
      recipient: user.address,
      amount: 250n,
      deadline: BigInt(block.timestamp + 3600),
      ...overrides,
    };
  }

  async function signAttestation(signer, attestation) {
    const network = await ethers.provider.getNetwork();
    return signer.signTypedData(
      {
        name: "StratoNativeRepresentationBridge",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await bridge.getAddress(),
      },
      attestationTypes,
      attestation,
    );
  }

  async function mintWithAttestation(overrides = {}) {
    const attestation = await buildAttestation(overrides);
    const signature = await signAttestation(attestationSigner, attestation);
    await bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]);
    return attestation;
  }

  beforeEach(async function () {
    [admin, user, stratoRecipient, attestationSigner, otherSigner] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("StratoNativeRepresentationToken");
    token = await upgrades.deployProxy(
      Token,
      ["Wrapped STRATO", "wSTRATO", admin.address],
      { initializer: "initialize" },
    );
    await token.waitForDeployment();

    const Bridge = await ethers.getContractFactory("StratoNativeRepresentationBridge");
    bridge = await upgrades.deployProxy(Bridge, [admin.address], {
      initializer: "initialize",
    });
    await bridge.waitForDeployment();

    const bridgeRole = await token.BRIDGE_ROLE();

    await token.grantRole(bridgeRole, await bridge.getAddress());

    stratoToken = ethers.Wallet.createRandom().address;
    sourceBridge = ethers.Wallet.createRandom().address;
    await bridge.setTokenMapping(stratoToken, await token.getAddress());
    await bridge.setAttestationSigner(attestationSigner.address, true);
    await bridge.setAttestationThreshold(1);
  });

  it("mints representation tokens with a valid STRATO withdrawal attestation", async function () {
    const attestation = await buildAttestation();
    const signature = await signAttestation(attestationSigner, attestation);

    await expect(
      bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]),
    )
      .to.emit(bridge, "RepresentationMinted")
      .withArgs(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        await token.getAddress(),
        user.address,
        250n,
        ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256", "address", "uint256"],
            [sourceChainId, sourceBridge, sourceWithdrawalId],
          ),
        ),
      );

    expect(await token.balanceOf(user.address)).to.equal(250n);
  });

  it("rejects attested mints from an untrusted signer", async function () {
    const attestation = await buildAttestation();
    const signature = await signAttestation(otherSigner, attestation);

    await expect(
      bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]),
    ).to.be.revertedWithCustomError(bridge, "BadAttestationSignatures");
  });

  it("rejects expired native mint attestations", async function () {
    const block = await ethers.provider.getBlock("latest");
    const attestation = await buildAttestation({
      deadline: BigInt(block.timestamp - 1),
    });
    const signature = await signAttestation(attestationSigner, attestation);

    await expect(
      bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]),
    ).to.be.revertedWithCustomError(bridge, "AttestationExpired");
  });

  it("rejects native mint attestations bound to another destination bridge", async function () {
    const attestation = await buildAttestation({
      destinationBridge: ethers.Wallet.createRandom().address,
    });
    const signature = await signAttestation(attestationSigner, attestation);

    await expect(
      bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]),
    ).to.be.revertedWithCustomError(bridge, "InvalidAttestation");
  });

  it("rejects duplicate attested mints for the same STRATO withdrawal id", async function () {
    const attestation = await buildAttestation();
    const signature = await signAttestation(attestationSigner, attestation);

    await bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]);

    await expect(
      bridge.connect(user).mintRepresentationWithAttestation(attestation, [signature]),
    ).to.be.revertedWithCustomError(bridge, "DuplicateMint");
  });

  it("redeems by pulling user tokens into the bridge, burning them, and emitting the redemption event", async function () {
    await mintWithAttestation();
    await token.connect(user).approve(await bridge.getAddress(), 200n);

    await expect(
      bridge
        .connect(user)
        .requestRedemption(await token.getAddress(), 200n, stratoRecipient.address),
    )
      .to.emit(bridge, "RedemptionRequested")
      .withArgs(await token.getAddress(), 200n, user.address, stratoRecipient.address, 1n);

    expect(await token.balanceOf(user.address)).to.equal(50n);
    expect(await token.balanceOf(await bridge.getAddress())).to.equal(0n);
    expect(await token.totalSupply()).to.equal(50n);
    expect(await bridge.redemptionId()).to.equal(1n);
  });

  it("does not let a bridge-role holder burn another user's balance directly", async function () {
    const bridgeRole = await token.BRIDGE_ROLE();

    await mintWithAttestation({ amount: 100n });
    await token.grantRole(bridgeRole, otherSigner.address);

    await expect(token.connect(otherSigner).burn(100n)).to.be.reverted;
    expect(await token.balanceOf(user.address)).to.equal(100n);
    expect(await token.totalSupply()).to.equal(100n);
  });

  it("rejects redemptions for unmapped representation tokens", async function () {
    const Token = await ethers.getContractFactory("StratoNativeRepresentationToken");
    const unmappedToken = await upgrades.deployProxy(
      Token,
      ["Unmapped", "UNM", admin.address],
      { initializer: "initialize" },
    );
    await unmappedToken.waitForDeployment();

    const bridgeRole = await unmappedToken.BRIDGE_ROLE();
    await unmappedToken.grantRole(bridgeRole, await bridge.getAddress());
    await unmappedToken.grantRole(bridgeRole, admin.address);
    await unmappedToken.connect(admin).mint(user.address, 10n);
    await unmappedToken.connect(user).approve(await bridge.getAddress(), 10n);

    await expect(
      bridge
        .connect(user)
        .requestRedemption(await unmappedToken.getAddress(), 10n, stratoRecipient.address),
    ).to.be.revertedWithCustomError(bridge, "TokenNotMapped");
  });

  it("rejects redemptions when the route is disabled", async function () {
    await mintWithAttestation({ amount: 100n });
    await token.connect(user).approve(await bridge.getAddress(), 100n);
    await bridge.disableTokenMapping(stratoToken);

    await expect(
      bridge
        .connect(user)
        .requestRedemption(await token.getAddress(), 100n, stratoRecipient.address),
    ).to.be.revertedWithCustomError(bridge, "RouteDisabled");

    expect(await token.balanceOf(user.address)).to.equal(100n);
    expect(await token.totalSupply()).to.equal(100n);
  });

  it("does not allow silent remapping of a live route", async function () {
    const Token = await ethers.getContractFactory("StratoNativeRepresentationToken");
    const replacementToken = await upgrades.deployProxy(
      Token,
      ["Wrapped STRATO V2", "wSTRATO2", admin.address],
      { initializer: "initialize" },
    );
    await replacementToken.waitForDeployment();

    await expect(
      bridge.setTokenMapping(stratoToken, await replacementToken.getAddress()),
    ).to.be.revertedWithCustomError(bridge, "ExistingTokenMapping");
  });

  it("only migrates mappings while paused and after legacy supply is cleared", async function () {
    const Token = await ethers.getContractFactory("StratoNativeRepresentationToken");
    const replacementToken = await upgrades.deployProxy(
      Token,
      ["Wrapped STRATO V2", "wSTRATO2", admin.address],
      { initializer: "initialize" },
    );
    await replacementToken.waitForDeployment();

    await mintWithAttestation({ amount: 1n });

    await expect(
      bridge.migrateTokenMapping(stratoToken, await replacementToken.getAddress(), false),
    ).to.be.reverted;

    await token.connect(user).approve(await bridge.getAddress(), 1n);
    await bridge
      .connect(user)
      .requestRedemption(await token.getAddress(), 1n, stratoRecipient.address);

    await bridge.pause();
    await bridge.migrateTokenMapping(stratoToken, await replacementToken.getAddress(), true);

    expect(await bridge.stratoToRepresentation(stratoToken)).to.equal(
      await replacementToken.getAddress(),
    );
    expect(await bridge.routeFrozen(stratoToken)).to.equal(true);
  });
});

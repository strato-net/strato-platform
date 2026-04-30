const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("StratoNativeRepresentationBridge", function () {
  let admin;
  let operator;
  let user;
  let stratoRecipient;
  let bridge;
  let token;
  let stratoToken;
  const sourceChainId = 2001n;
  const sourceWithdrawalId = 17n;
  let sourceBridge;

  beforeEach(async function () {
    [admin, operator, user, stratoRecipient] = await ethers.getSigners();

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
    const bridgeOperatorRole = await bridge.BRIDGE_OPERATOR_ROLE();

    await token.grantRole(bridgeRole, await bridge.getAddress());
    await bridge.grantRole(bridgeOperatorRole, operator.address);

    stratoToken = ethers.Wallet.createRandom().address;
    sourceBridge = ethers.Wallet.createRandom().address;
    await bridge.setTokenMapping(stratoToken, await token.getAddress());
  });

  it("mints representation tokens only through an operator on a mapped route", async function () {
    await expect(
      bridge
        .connect(operator)
        .mintRepresentation(
          sourceChainId,
          sourceBridge,
          sourceWithdrawalId,
          stratoToken,
          user.address,
          250n,
        ),
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

  it("rejects duplicate mints for the same STRATO withdrawal id", async function () {
    await bridge
      .connect(operator)
      .mintRepresentation(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        user.address,
        250n,
      );

    await expect(
      bridge
        .connect(operator)
        .mintRepresentation(
          sourceChainId,
          sourceBridge,
          sourceWithdrawalId,
          stratoToken,
          user.address,
          250n,
        ),
    ).to.be.revertedWithCustomError(bridge, "DuplicateMint");
  });

  it("redeems by pulling user tokens into the bridge, burning them, and emitting the redemption event", async function () {
    await bridge
      .connect(operator)
      .mintRepresentation(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        user.address,
        250n,
      );
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

    await bridge
      .connect(operator)
      .mintRepresentation(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        user.address,
        100n,
      );
    await token.grantRole(bridgeRole, operator.address);

    await expect(token.connect(operator).burn(100n)).to.be.reverted;
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
    await bridge
      .connect(operator)
      .mintRepresentation(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        user.address,
        100n,
      );
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

    await bridge
      .connect(operator)
      .mintRepresentation(
        sourceChainId,
        sourceBridge,
        sourceWithdrawalId,
        stratoToken,
        user.address,
        1n,
      );

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

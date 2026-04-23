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
    await bridge.setTokenMapping(stratoToken, await token.getAddress());
  });

  it("mints representation tokens only through an operator on a mapped route", async function () {
    await expect(
      bridge.connect(operator).mintRepresentation(stratoToken, user.address, 250n),
    )
      .to.emit(bridge, "RepresentationMinted")
      .withArgs(stratoToken, await token.getAddress(), user.address, 250n);

    expect(await token.balanceOf(user.address)).to.equal(250n);
  });

  it("redeems by pulling user tokens into the bridge, burning them, and emitting the redemption event", async function () {
    await bridge.connect(operator).mintRepresentation(stratoToken, user.address, 250n);
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

    await bridge.connect(operator).mintRepresentation(stratoToken, user.address, 100n);
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
});

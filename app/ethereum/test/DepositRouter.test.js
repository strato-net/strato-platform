const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("DepositRouter", function () {
  async function deployFixture() {
    const [owner, vault, user, replacementVault] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockDepositToken")).deploy();
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const router = await upgrades.deployProxy(
      await ethers.getContractFactory("DepositRouter"),
      [await permit2.getAddress(), vault.address, owner.address],
      { kind: "uups" }
    );
    const targetStratoToken = ethers.Wallet.createRandom().address;
    const amount = ethers.parseEther("100");

    await router.setPermitted(await token.getAddress(), true);
    await router.setRoutePermitted(await token.getAddress(), targetStratoToken, true);
    await token.mint(user.address, amount * 2n);
    await token.connect(user).approve(await permit2.getAddress(), amount * 2n);

    return {
      router,
      token,
      vault,
      user,
      replacementVault,
      targetStratoToken,
      amount,
    };
  }

  function routerEvents(router, receipt) {
    return receipt.logs
      .map((log) => {
        try {
          return router.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  it("emits only the action event and shares the deposit counter", async function () {
    const { router, token, vault, user, targetStratoToken, amount } =
      await deployFixture();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    const actionReceipt = await (
      await router.connect(user).depositWithAction(
        await token.getAddress(),
        amount,
        user.address,
        targetStratoToken,
        2,
        ethers.Wallet.createRandom().address,
        1,
        1,
        deadline,
        "0x"
      )
    ).wait();
    const actionEvents = routerEvents(router, actionReceipt);

    expect(actionEvents.map((event) => event.name)).to.deep.equal([
      "DepositRoutedWithAction",
    ]);
    expect(actionEvents[0].args.depositId).to.equal(1);
    expect(await token.balanceOf(vault.address)).to.equal(amount);
    expect(await router.externalBridgeVault()).to.equal(vault.address);

    const standardReceipt = await (
      await router.connect(user).deposit(
        await token.getAddress(),
        amount,
        user.address,
        targetStratoToken,
        2,
        deadline,
        "0x"
      )
    ).wait();
    const standardEvents = routerEvents(router, standardReceipt);

    expect(standardEvents.map((event) => event.name)).to.deep.equal([
      "DepositRouted",
    ]);
    expect(standardEvents[0].args.depositId).to.equal(2);
    expect(await router.version()).to.equal("3.1.0");
  });

  it("moves subsequent deposits when governance updates the vault", async function () {
    const {
      router,
      token,
      vault,
      user,
      replacementVault,
      targetStratoToken,
      amount,
    } = await deployFixture();
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;

    await expect(router.setExternalBridgeVault(replacementVault.address))
      .to.emit(router, "ExternalBridgeVaultUpdated")
      .withArgs(vault.address, replacementVault.address);

    await router.connect(user).deposit(
      await token.getAddress(),
      amount,
      user.address,
      targetStratoToken,
      1,
      deadline,
      "0x"
    );

    expect(await token.balanceOf(vault.address)).to.equal(0);
    expect(await token.balanceOf(replacementVault.address)).to.equal(amount);
  });
});

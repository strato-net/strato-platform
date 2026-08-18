const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("DepositRouter", function () {
  async function deployFixture() {
    const [owner, safe, user] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockDepositToken")).deploy();
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const router = await upgrades.deployProxy(
      await ethers.getContractFactory("DepositRouter"),
      [await permit2.getAddress(), safe.address, owner.address],
      { kind: "uups" }
    );
    const targetStratoToken = ethers.Wallet.createRandom().address;
    const amount = ethers.parseEther("100");

    await router.setPermitted(await token.getAddress(), true);
    await router.setRoutePermitted(await token.getAddress(), targetStratoToken, true);
    await router.setPermitted(ethers.ZeroAddress, true);
    await router.setRoutePermitted(ethers.ZeroAddress, targetStratoToken, true);
    await token.mint(user.address, amount * 2n);
    await token.connect(user).approve(await permit2.getAddress(), amount * 2n);

    return { router, token, safe, user, targetStratoToken, amount };
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
    const { router, token, safe, user, targetStratoToken, amount } =
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
    expect(await token.balanceOf(safe.address)).to.equal(amount);

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

  it("routes native ETH with an action and preserves its intent", async function () {
    const { router, safe, user, targetStratoToken } = await deployFixture();
    const amount = ethers.parseEther("1");
    const actionToken = ethers.Wallet.createRandom().address;
    const minFinalOut = ethers.parseEther("25");
    const safeBalanceBefore = await ethers.provider.getBalance(safe.address);

    const receipt = await (
      await router.connect(user).depositETHWithAction(
        user.address,
        targetStratoToken,
        4,
        actionToken,
        minFinalOut,
        { value: amount }
      )
    ).wait();
    const events = routerEvents(router, receipt);

    expect(events.map((event) => event.name)).to.deep.equal([
      "DepositRoutedWithAction",
    ]);
    expect(events[0].args.token).to.equal(ethers.ZeroAddress);
    expect(events[0].args.amount).to.equal(amount);
    expect(events[0].args.sender).to.equal(user.address);
    expect(events[0].args.stratoAddress).to.equal(user.address);
    expect(events[0].args.targetStratoToken).to.equal(targetStratoToken);
    expect(events[0].args.depositId).to.equal(1);
    expect(events[0].args.action).to.equal(4);
    expect(events[0].args.actionToken).to.equal(actionToken);
    expect(events[0].args.minFinalOut).to.equal(minFinalOut);
    expect(await ethers.provider.getBalance(safe.address)).to.equal(
      safeBalanceBefore + amount
    );
  });

  it("applies native ETH deposit validation to action deposits", async function () {
    const { router, user, targetStratoToken } = await deployFixture();
    const actionToken = ethers.Wallet.createRandom().address;

    await expect(
      router.connect(user).depositETHWithAction(
        user.address,
        targetStratoToken,
        4,
        actionToken,
        1
      )
    ).to.be.revertedWithCustomError(router, "ZeroAmount");

    await router.setRoutePermitted(ethers.ZeroAddress, targetStratoToken, false);
    await expect(
      router.connect(user).depositETHWithAction(
        user.address,
        targetStratoToken,
        4,
        actionToken,
        1,
        { value: 1 }
      )
    ).to.be.revertedWithCustomError(router, "NotPermitted");
  });
});

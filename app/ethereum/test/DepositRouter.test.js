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
        "0x",
        0
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
        "0x",
        0
      )
    ).wait();
    const standardEvents = routerEvents(router, standardReceipt);

    expect(standardEvents.map((event) => event.name)).to.deep.equal([
      "DepositRouted",
    ]);
    expect(standardEvents[0].args.depositId).to.equal(2);
    expect(await router.version()).to.equal("3.0.0");
  });

  describe("maxFeeBps", function () {
    // The fee rides in the deposit event so the destination bridge can prove
    // the recipient was not short-changed by a fast-fill LP. That makes an
    // unbounded fee a real drain, not just bad UX -- these pin the bound.
    const bps = (amount, b) => (amount * BigInt(b)) / 10000n;

    async function depositFee(router, token, user, targetStratoToken, amount, maxFee) {
      const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
      return router.connect(user).deposit(
        await token.getAddress(), amount, user.address, targetStratoToken,
        2, deadline, "0x", maxFee,
      );
    }

    it("defaults to zero, rejecting any fee-bearing deposit", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      expect(await router.maxFeeBps()).to.equal(0);
      await expect(
        depositFee(router, token, user, targetStratoToken, amount, 1n),
      ).to.be.revertedWithCustomError(router, "FeeAboveMaximum");
    });

    it("still allows a zero fee while disabled", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      await expect(depositFee(router, token, user, targetStratoToken, amount, 0)).to.not.be.reverted;
    });

    it("accepts a fee at the bound and rejects one wei above it", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      await router.setMaxFeeBps(100); // 1%
      const limit = bps(amount, 100);
      await expect(depositFee(router, token, user, targetStratoToken, amount, limit)).to.not.be.reverted;
      await expect(
        depositFee(router, token, user, targetStratoToken, amount, limit + 1n),
      ).to.be.revertedWithCustomError(router, "FeeAboveMaximum");
    });

    it("emits the fee so the destination side can prove it", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      await router.setMaxFeeBps(500);
      const fee = bps(amount, 250);
      const receipt = await (await depositFee(router, token, user, targetStratoToken, amount, fee)).wait();
      const ev = routerEvents(router, receipt).find((e) => e.name === "DepositRouted");
      expect(ev.args.maxFee).to.equal(fee);
    });

    it("rejects a bound above 100%", async function () {
      const { router } = await deployFixture();
      await expect(router.setMaxFeeBps(10001)).to.be.revertedWithCustomError(router, "FeeAboveMaximum");
      await expect(router.setMaxFeeBps(10000)).to.not.be.reverted;
    });

    it("is owner-only", async function () {
      const { router, user } = await deployFixture();
      await expect(router.connect(user).setMaxFeeBps(100)).to.be.reverted;
    });
  });

});

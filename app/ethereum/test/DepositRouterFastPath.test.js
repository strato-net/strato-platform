const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * The solver fast path on the external chain: fee-bearing deposits, the claim
 * ladder and its solver-set exit offers, the STATIC custody settlement that
 * routes to whoever holds the claim, and bonded announcements.
 *
 * The point of the settlement design is that the Safe payload names the
 * withdrawal and its terms, never a payee, so it can be proposed and signed
 * before any solver exists and stays valid however the ladder moves. These
 * tests assert that directly: the same calldata pays the user, a solver, or a
 * later solver, depending only on what happened in between.
 */
describe("DepositRouter fast path", function () {
  const HALF_LIFE = 21600n; // six hours
  const FEE_BPS = 500n; // 5%
  const BOND = 10n * 10n ** 18n;
  const TTL = 7n * 86400n;

  const SOURCE_CHAIN_ID = 24601n;
  const WITHDRAWAL_ID = 7n;

  async function deployFixture() {
    const [owner, safe, hotWallet, user, solverA, solverB, announcer, treasury] =
      await ethers.getSigners();

    const token = await (await ethers.getContractFactory("MockDepositToken")).deploy();
    const bond = await (
      await ethers.getContractFactory("MockFastPathToken")
    ).deploy("Bond", "BOND", 18);
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const feeMath = await (
      await ethers.getContractFactory("BridgeFeeDecayHarness")
    ).deploy();

    const router = await upgrades.deployProxy(
      await ethers.getContractFactory("DepositRouter"),
      [await permit2.getAddress(), safe.address, owner.address],
      { kind: "uups" }
    );

    const targetStratoToken = ethers.Wallet.createRandom().address;
    await router.setPermitted(await token.getAddress(), true);
    await router.setRoutePermitted(await token.getAddress(), targetStratoToken, true);
    await router.setPermitted(ethers.ZeroAddress, true);
    await router.setRoutePermitted(ethers.ZeroAddress, targetStratoToken, true);

    await router.initializeFastPath(
      HALF_LIFE,
      FEE_BPS,
      await bond.getAddress(),
      BOND,
      treasury.address,
      TTL,
      [safe.address, hotWallet.address]
    );

    const amount = ethers.parseEther("100");
    for (const who of [user, solverA, solverB, safe, hotWallet]) {
      await token.mint(who.address, amount * 10n);
      await token.connect(who).approve(await permit2.getAddress(), amount * 10n);
      await token.connect(who).approve(await router.getAddress(), amount * 10n);
    }
    await bond.mint(announcer.address, BOND * 10n);
    await bond.connect(announcer).approve(await router.getAddress(), BOND * 10n);

    return {
      owner, safe, hotWallet, user, solverA, solverB, announcer, treasury,
      router, token, bond, permit2, feeMath, targetStratoToken, amount,
    };
  }

  function termsFor(overrides = {}) {
    return {
      sourceChainId: SOURCE_CHAIN_ID,
      sourceBridge: "0x000000000000000000000000000000000000BEEF",
      withdrawalId: WITHDRAWAL_ID,
      token: ethers.ZeroAddress,
      recipient: ethers.ZeroAddress,
      amount: ethers.parseEther("100"),
      maxFee: ethers.parseEther("3"),
      requestedAt: 0n,
      feeHalfLife: HALF_LIFE,
      ...overrides,
    };
  }

  /// Terms whose origin timestamp is far enough ahead that a test can pin the
  /// fill to an exact point on the decay curve.
  async function futureTerms(overrides = {}) {
    return termsFor({ requestedAt: BigInt(await time.latest()) + 60n, ...overrides });
  }

  /**
   * Take rung zero at a chosen point on the decay curve.
   *
   * The rung-zero fee is a function of the block timestamp, so a test that does
   * not pin the timestamp is asserting against a fee it cannot predict. `at`
   * defaults to the request itself, where the fee is exactly `maxFee`.
   */
  async function fillRungZero(router, solver, terms, opts = {}) {
    const at = opts.at ?? terms.requestedAt;
    const expectedFee = opts.expectedFee ?? terms.maxFee;
    await time.setNextBlockTimestamp(at);
    return router
      .connect(solver)
      .fillWithdrawal(terms, expectedFee, opts.transferable ?? false, opts.exitFee ?? 0, opts.overrides ?? {});
  }

  // ---------------------------------------------------------------- deposits

  describe("fee-bearing deposits", function () {
    it("commits the fee, the request time and the half-life in the log", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      const deadline = (await time.latest()) + 3600;
      const maxFee = ethers.parseEther("3");

      const receipt = await (
        await router
          .connect(user)
          .depositWithFee(
            await token.getAddress(),
            amount,
            user.address,
            targetStratoToken,
            maxFee,
            1,
            deadline,
            "0x"
          )
      ).wait();

      const parsed = receipt.logs
        .map((log) => { try { return router.interface.parseLog(log); } catch { return null; } })
        .filter(Boolean);

      expect(parsed.map((e) => e.name)).to.deep.equal(["DepositRoutedWithFee"]);
      const event = parsed[0].args;
      expect(event.amount).to.equal(amount);
      expect(event.maxFee).to.equal(maxFee);
      expect(event.feeHalfLife).to.equal(HALF_LIFE);
      // The schedule starts on THIS chain, at this block: STRATO measures the
      // decay from here, so a slow relayer costs the solver, not the user.
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      expect(event.requestedAt).to.equal(BigInt(block.timestamp));
    });

    it("refuses a fee over the configured ceiling", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      const deadline = (await time.latest()) + 3600;

      await expect(
        router.connect(user).depositWithFee(
          await token.getAddress(), amount, user.address, targetStratoToken,
          ethers.parseEther("6"), 1, deadline, "0x"
        )
      ).to.be.revertedWithCustomError(router, "FeeTooLarge");
    });

    it("prices ether deposits the same way", async function () {
      const { router, user, targetStratoToken } = await deployFixture();
      const value = ethers.parseEther("1");

      await expect(
        router.connect(user).depositETHWithFee(
          user.address, targetStratoToken, ethers.parseEther("0.03"), { value }
        )
      ).to.emit(router, "DepositRoutedWithFee");

      await expect(
        router.connect(user).depositETHWithFee(
          user.address, targetStratoToken, ethers.parseEther("0.06"), { value }
        )
      ).to.be.revertedWithCustomError(router, "FeeTooLarge");
    });

    it("leaves the fee-free entry points and their event untouched", async function () {
      const { router, token, user, targetStratoToken, amount } = await deployFixture();
      const deadline = (await time.latest()) + 3600;

      await expect(
        router.connect(user).deposit(
          await token.getAddress(), amount, user.address, targetStratoToken, 1, deadline, "0x"
        )
      ).to.emit(router, "DepositRouted");
    });
  });

  // ------------------------------------------------------------ claim ladder

  describe("claim ladder", function () {
    it("pays the recipient the amount less the decayed fee", async function () {
      const { router, token, user, solverA } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      const before = await token.balanceOf(user.address);
      // Fill exactly one half-life after the request: the capturable fee is
      // half of what it was, and the user keeps the difference.
      const expectedFee = ethers.parseEther("1.5");
      await expect(
        fillRungZero(router, solverA, terms, {
          at: terms.requestedAt + HALF_LIFE,
          expectedFee,
        })
      ).to.emit(router, "WithdrawalFilled");

      expect(await token.balanceOf(user.address)).to.equal(
        before + terms.amount - expectedFee
      );
    });

    it("fills a native withdrawal that overpays, and refunds the difference", async function () {
      const { router, user, solverA } = await deployFixture();
      // token = address(0) is the native route.
      const terms = await futureTerms({ recipient: user.address });
      const at = terms.requestedAt + HALF_LIFE;
      const netPaid = terms.amount - ethers.parseEther("1.5");

      const userBefore = await ethers.provider.getBalance(user.address);
      // Overpay deliberately: a filler that cannot choose its block cannot know
      // netPaid to the wei, so it must be allowed to send more than enough.
      const sent = netPaid + ethers.parseEther("5");
      const tx = await fillRungZero(router, solverA, terms, {
        at,
        expectedFee: ethers.parseEther("1.5"),
        overrides: { value: sent },
      });
      const receipt = await tx.wait();

      // The recipient receives exactly the schedule's amount, not what was sent.
      expect(await ethers.provider.getBalance(user.address)).to.equal(userBefore + netPaid);
      // And the filler is charged only netPaid plus gas -- the excess came back.
      await expect(tx).to.changeEtherBalance(
        solverA,
        -(netPaid + receipt.gasUsed * receipt.gasPrice),
        { includeFee: true }
      );
    });

    it("refuses a native fill that underpays", async function () {
      const { router, user, solverA } = await deployFixture();
      const terms = await futureTerms({ recipient: user.address });
      const at = terms.requestedAt + HALF_LIFE;
      const netPaid = terms.amount - ethers.parseEther("1.5");

      await expect(
        fillRungZero(router, solverA, terms, {
          at,
          expectedFee: ethers.parseEther("1.5"),
          overrides: { value: netPaid - 1n },
        })
      ).to.be.revertedWithCustomError(router, "WrongEthValue");
    });

    /**
     * The regression this guards: netPaid falls every second while the fee
     * decays, so an exact-value requirement made a native rung-zero fill
     * unreachable for any caller that could not choose its block. Quoting for
     * one second and landing in a later one must still work.
     */
    it("lets a native filler quote one second and land in another", async function () {
      const { router, user, solverA } = await deployFixture();
      const terms = await futureTerms({ recipient: user.address });
      const quotedAt = terms.requestedAt + HALF_LIFE;
      const quotedNet = terms.amount - ethers.parseEther("1.5");

      const userBefore = await ethers.provider.getBalance(user.address);
      // Lands 30 seconds after the quote: the fee is lower, so the true
      // netPaid is HIGHER than quoted, and the value sent must still cover it.
      await fillRungZero(router, solverA, terms, {
        at: quotedAt + 30n,
        expectedFee: ethers.parseEther("1.4"),
        overrides: { value: quotedNet + ethers.parseEther("1") },
      });

      const paid = (await ethers.provider.getBalance(user.address)) - userBefore;
      expect(paid).to.be.greaterThan(quotedNet);
      expect(paid).to.be.lessThan(terms.amount);
    });

    /**
     * The kill switch used on 2026-09-18, when the routers were upgraded ahead
     * of the relayer image. A `feeBpsCeiling` of 0 has to make a fee-bearing
     * deposit REVERT rather than quietly succeed with no fee, because the
     * running relayer could not see `DepositRoutedWithFee` and the deposit
     * would have been taken into custody and never relayed.
     *
     * Asserted here rather than against the live chain on purpose: a plain
     * eth_call probe reverts inside `_processDeposit`, which runs BEFORE
     * `_resolveFeeTerms`, so it produces a revert that looks like proof of the
     * fee gate and is not.
     */
    it("refuses a fee-bearing deposit once the ceiling is set to zero", async function () {
      const { router, token, owner, user, targetStratoToken, amount } = await deployFixture();
      const deadline = (await time.latest()) + 3600;

      await router.connect(owner).setFeeConfig(HALF_LIFE, 0, false);
      expect(await router.maxFeeBps()).to.equal(0);

      await expect(
        router.connect(user).depositWithFee(
          await token.getAddress(), amount, user.address, targetStratoToken,
          ethers.parseEther("1"), 1, deadline, "0x"
        )
      ).to.be.revertedWithCustomError(router, "FeeTooLarge");

      // The old path must keep working, or the switch breaks the bridge it is
      // meant to protect.
      await expect(
        router.connect(user).deposit(
          await token.getAddress(), amount, user.address, targetStratoToken,
          2, deadline, "0x"
        )
      ).to.emit(router, "DepositRouted");
    });

    it("refuses a fill priced against a stale fee", async function () {
      const { router, token, user, solverA } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(), recipient: user.address,
      });

      // Priced as if no time had passed, submitted a half-life later.
      await expect(
        fillRungZero(router, solverA, terms, {
          at: terms.requestedAt + HALF_LIFE,
          expectedFee: ethers.parseEther("3"),
        })
      ).to.be.revertedWithCustomError(router, "FeeBelowMinimum");
    });

    it("keeps a claim that its holder has not put up for sale", async function () {
      const { router, token, user, solverA, solverB } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await fillRungZero(router, solverA, terms);
      await expect(
        router.connect(solverB).fillWithdrawal(terms, 0, false, 0)
      ).to.be.revertedWithCustomError(router, "NotTransferable");
    });

    it("hands a claim over at the holder's asking price", async function () {
      const { router, token, user, solverA, solverB } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      const exitFee = ethers.parseEther("1");

      const aBefore = await token.balanceOf(solverA.address);
      const bBefore = await token.balanceOf(solverB.address);
      const userBefore = await token.balanceOf(user.address);

      await fillRungZero(router, solverA, terms, { transferable: true, exitFee });

      const quote = await router.quoteWithdrawalFill(terms);
      expect(quote.payTo).to.equal(solverA.address);
      expect(quote.feeCharged).to.equal(exitFee);
      expect(quote.netToPay).to.equal(terms.amount - exitFee);
      expect(quote.forSale).to.equal(true);

      await router.connect(solverB).fillWithdrawal(terms, exitFee, false, 0);

      // A fronted 97 and was bought out at 99: it keeps 2 for having carried
      // the risk first. B is out 99 and is owed the full 100.
      expect(await token.balanceOf(solverA.address)).to.equal(
        aBefore - ethers.parseEther("97") + ethers.parseEther("99")
      );
      expect(await token.balanceOf(solverB.address)).to.equal(bBefore - ethers.parseEther("99"));
      expect(await token.balanceOf(user.address)).to.equal(userBefore + ethers.parseEther("97"));
    });

    it("lets a holder shed a claim at a loss, above the user's ceiling", async function () {
      const { router, token, user, solverA, solverB } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      // Five, where the user only ever offered three. Nothing bounds this: the
      // user's leg is already settled and A is paying to be rid of the risk.
      const exitFee = ethers.parseEther("5");

      const aBefore = await token.balanceOf(solverA.address);
      await fillRungZero(router, solverA, terms, { transferable: true, exitFee });
      await router.connect(solverB).fillWithdrawal(terms, exitFee, false, 0);

      expect(await token.balanceOf(solverA.address)).to.equal(aBefore - ethers.parseEther("2"));
    });

    it("lets a holder reprice or withdraw the offer, and refuses a stale taker", async function () {
      const { router, token, user, solverA, solverB } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await fillRungZero(router, solverA, terms, { transferable: true, exitFee: ethers.parseEther("1") });
      // Repricing UPWARD cannot hurt a taker -- a bigger exitFee means they pay
      // less and keep more -- so the floor lets it through.
      await router
        .connect(solverA)
        .setWithdrawalClaimExitOffer(terms, true, ethers.parseEther("2"));

      // Cutting the price after a taker committed is what the floor refuses.
      await router
        .connect(solverA)
        .setWithdrawalClaimExitOffer(terms, true, ethers.parseEther("0.5"));
      await expect(
        router.connect(solverB).fillWithdrawal(terms, ethers.parseEther("1"), false, 0)
      ).to.be.revertedWithCustomError(router, "FeeBelowMinimum");

      await router.connect(solverA).setWithdrawalClaimExitOffer(terms, false, 0);
      await expect(
        router.connect(solverB).fillWithdrawal(terms, ethers.parseEther("0.5"), false, 0)
      ).to.be.revertedWithCustomError(router, "NotTransferable");

      await expect(
        router.connect(solverB).setWithdrawalClaimExitOffer(terms, true, 0)
      ).to.be.revertedWithCustomError(router, "NotPermitted");
    });

    it("refuses a claim on different terms than the ladder below it", async function () {
      const { router, token, user, solverA, solverB } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await fillRungZero(router, solverA, terms, { transferable: true, exitFee: ethers.parseEther("1") });

      // A different payee, same amount: a solver trying to bind the ladder to
      // somewhere the money should not go.
      const otherTerms = { ...terms, recipient: solverB.address };
      await expect(
        router.connect(solverB).fillWithdrawal(otherTerms, ethers.parseEther("1"), false, 0)
      ).to.be.revertedWithCustomError(router, "TermsMismatch");
    });

    it("refuses a holder re-claiming their own position", async function () {
      const { router, token, user, solverA } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await fillRungZero(router, solverA, terms, { transferable: true, exitFee: ethers.parseEther("1") });
      await expect(
        router.connect(solverA).fillWithdrawal(terms, ethers.parseEther("1"), false, 0)
      ).to.be.revertedWithCustomError(router, "AlreadyClaimant");
    });

    it("fills a native-asset withdrawal with exactly the net in value", async function () {
      const { router, user, solverA, feeMath } = await deployFixture();
      const terms = await futureTerms({
        token: ethers.ZeroAddress,
        recipient: user.address,
      });
      await expect(
        fillRungZero(router, solverA, terms, {
          overrides: { value: terms.amount - terms.maxFee - 1n },
        })
      ).to.be.revertedWithCustomError(router, "WrongEthValue");

      // The reverted attempt still mined a block, so the retry lands a second
      // later and owes a second of decay. Ask the shared library what that is
      // rather than guessing.
      const at = terms.requestedAt + 1n;
      const fee = await feeMath.decayedFee(terms.maxFee, terms.requestedAt, terms.feeHalfLife, at);
      const net = terms.amount - fee;

      const before = await ethers.provider.getBalance(user.address);
      await fillRungZero(router, solverA, terms, {
        at,
        expectedFee: fee,
        overrides: { value: net },
      });
      expect(await ethers.provider.getBalance(user.address)).to.equal(before + net);
    });
  });

  // ---------------------------------------------------- static settlement

  describe("custody settlement", function () {
    it("pays the recipient when nobody claimed", async function () {
      const { router, token, user, safe } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      const before = await token.balanceOf(user.address);
      await expect(router.connect(safe).settleWithdrawal(terms))
        .to.emit(router, "WithdrawalSettled")
        .withArgs(await router.withdrawalKeyFor(terms.sourceChainId, terms.sourceBridge, terms.withdrawalId),
                  user.address, user.address, await token.getAddress(), terms.amount, 0);
      expect(await token.balanceOf(user.address)).to.equal(before + terms.amount);
    });

    /**
     * THE POINT OF THE WHOLE DESIGN. The calldata here is byte-identical to the
     * unclaimed case above -- it names the withdrawal and its terms, never a
     * payee -- so the Safe proposal can be built and signed before any solver
     * exists and still routes correctly once one does.
     */
    it("pays the last claimant from the identical, pre-signable payload", async function () {
      const { router, token, user, solverA, solverB, safe } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      // The payload is fixed here, before anybody has claimed.
      const payload = router.interface.encodeFunctionData("settleWithdrawal", [terms]);

      await fillRungZero(router, solverA, terms, { transferable: true, exitFee: ethers.parseEther("1") });
      await router.connect(solverB).fillWithdrawal(terms, ethers.parseEther("1"), false, 0);

      const bBefore = await token.balanceOf(solverB.address);
      const userBefore = await token.balanceOf(user.address);

      await safe.sendTransaction({ to: await router.getAddress(), data: payload });

      expect(await token.balanceOf(solverB.address)).to.equal(bBefore + terms.amount);
      expect(await token.balanceOf(user.address)).to.equal(userBefore);
    });

    it("voids a claim made on terms custody did not settle, and still pays the user", async function () {
      const { router, token, user, solverA, safe } = await deployFixture();
      const requestedAt = BigInt(await time.latest());
      const claimed = termsFor({
        token: await token.getAddress(), recipient: user.address,
        requestedAt: BigInt(await time.latest()) + 60n,
      });
      // Custody settles the same withdrawal for a different amount: whatever the
      // solver thought they were buying, it was not this.
      const settled = { ...claimed, amount: ethers.parseEther("50") };

      await fillRungZero(router, solverA, claimed);

      const aBefore = await token.balanceOf(solverA.address);
      const userBefore = await token.balanceOf(user.address);

      await expect(router.connect(safe).settleWithdrawal(settled))
        .to.emit(router, "WithdrawalClaimVoided");

      expect(await token.balanceOf(user.address)).to.equal(userBefore + settled.amount);
      expect(await token.balanceOf(solverA.address)).to.equal(aBefore);
    });

    it("only lets an allowlisted settler route a payout", async function () {
      const { router, token, user, solverA, owner, hotWallet } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      // Left open, anyone could mark a withdrawal settled with their own
      // donation and block the real payout.
      await expect(
        router.connect(solverA).settleWithdrawal(terms)
      ).to.be.revertedWithCustomError(router, "NotPermitted");

      await router.connect(hotWallet).settleWithdrawal(terms);

      await expect(
        router.connect(owner).setPayoutSettler(ethers.ZeroAddress, true)
      ).to.be.revertedWithCustomError(router, "InvalidAddress");
    });

    it("settles once, and refuses a claim afterwards", async function () {
      const { router, token, user, solverA, safe } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await router.connect(safe).settleWithdrawal(terms);
      await expect(
        router.connect(safe).settleWithdrawal(terms)
      ).to.be.revertedWithCustomError(router, "AlreadySettled");
      await expect(
        fillRungZero(router, solverA, terms)
      ).to.be.revertedWithCustomError(router, "AlreadySettled");
    });
  });

  // ------------------------------------------------------- announcements

  describe("bonded announcements", function () {
    it("takes a bond, and gives it back when the relayer confirms", async function () {
      const { router, token, user, announcer, bond, owner } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      const before = await bond.balanceOf(announcer.address);
      await expect(router.connect(announcer).announceWithdrawal(terms))
        .to.emit(router, "WithdrawalAnnounced");

      expect(await bond.balanceOf(announcer.address)).to.equal(before - BOND);
      expect(await router.bondedBalance(await bond.getAddress())).to.equal(BOND);

      const key = await router.withdrawalKeyFor(
        terms.sourceChainId, terms.sourceBridge, terms.withdrawalId
      );
      await router.connect(owner).confirmAnnouncement(key);
      expect(await bond.balanceOf(announcer.address)).to.equal(before);
      expect(await router.bondedBalance(await bond.getAddress())).to.equal(0);
    });

    it("lets the announcer reclaim after the ttl, and not before", async function () {
      const { router, token, user, announcer, bond } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      await router.connect(announcer).announceWithdrawal(terms);
      const key = await router.withdrawalKeyFor(
        terms.sourceChainId, terms.sourceBridge, terms.withdrawalId
      );

      await expect(
        router.connect(announcer).reclaimAnnouncementBond(key)
      ).to.be.revertedWithCustomError(router, "BondNotReclaimable");

      // A relayer outage must not read as fraud: the bond comes back on its
      // own, without an admin.
      await time.increase(TTL);
      const before = await bond.balanceOf(announcer.address);
      await router.connect(announcer).reclaimAnnouncementBond(key);
      expect(await bond.balanceOf(announcer.address)).to.equal(before + BOND);
    });

    it("slashes only on governance rejection", async function () {
      const { router, token, user, announcer, bond, owner, treasury, solverA } =
        await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      await router.connect(announcer).announceWithdrawal(terms);
      const key = await router.withdrawalKeyFor(
        terms.sourceChainId, terms.sourceBridge, terms.withdrawalId
      );

      await expect(
        router.connect(solverA).rejectAnnouncement(key)
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");

      const before = await bond.balanceOf(treasury.address);
      await router.connect(owner).rejectAnnouncement(key);
      expect(await bond.balanceOf(treasury.address)).to.equal(before + BOND);
      expect(await router.bondedBalance(await bond.getAddress())).to.equal(0);

      await expect(
        router.connect(announcer).reclaimAnnouncementBond(key)
      ).to.be.revertedWithCustomError(router, "BondAlreadyResolved");
    });

    /// A router that never held anyone's money now does. A sweep that could
    /// take a live bond would make posting one unsafe.
    it("keeps live bonds out of reach of the sweep", async function () {
      const { router, token, user, announcer, bond, owner, treasury } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      await router.connect(announcer).announceWithdrawal(terms);

      // A stray transfer on top of the bond.
      await bond.mint(await router.getAddress(), 5n * 10n ** 18n);

      await router.connect(owner).sweepERC20(await bond.getAddress(), treasury.address);
      expect(await bond.balanceOf(treasury.address)).to.equal(5n * 10n ** 18n);
      expect(await bond.balanceOf(await router.getAddress())).to.equal(BOND);
    });

    it("refuses a second announcement for the same withdrawal", async function () {
      const { router, token, user, announcer } = await deployFixture();
      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });
      await router.connect(announcer).announceWithdrawal(terms);
      await expect(
        router.connect(announcer).announceWithdrawal(terms)
      ).to.be.revertedWithCustomError(router, "AlreadyAnnounced");
    });
  });

  // -------------------------------------------------------------- switches

  describe("switches fail closed", function () {
    it("refuses fills and announcements until the fast path is configured", async function () {
      const [owner, safe, , user, solverA] = await ethers.getSigners();
      const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
      const token = await (await ethers.getContractFactory("MockDepositToken")).deploy();
      const router = await upgrades.deployProxy(
        await ethers.getContractFactory("DepositRouter"),
        [await permit2.getAddress(), safe.address, owner.address],
        { kind: "uups" }
      );
      await router.setPermitted(await token.getAddress(), true);

      const terms = await futureTerms({
        token: await token.getAddress(),
        recipient: user.address,
      });

      await expect(
        router.connect(solverA).fillWithdrawal(terms, 0, false, 0)
      ).to.be.revertedWithCustomError(router, "FillsDisabled");
      await expect(
        router.connect(solverA).announceWithdrawal(terms)
      ).to.be.revertedWithCustomError(router, "AnnouncementsDisabled");
      // A zero ceiling refuses every fee, so no deposit can offer one either.
      await expect(
        router.connect(user).depositWithFee(
          await token.getAddress(), 1n, user.address, ethers.ZeroAddress, 1n, 1, 1, "0x"
        )
      ).to.be.reverted;
    });

    it("rejects an invalid decay configuration", async function () {
      const { router, owner } = await deployFixture();

      await expect(
        router.connect(owner).setFeeConfig(0, FEE_BPS, true)
      ).to.be.revertedWithCustomError(router, "BadHalfLife");
      await expect(
        router.connect(owner).setFeeConfig(259201, FEE_BPS, true)
      ).to.be.revertedWithCustomError(router, "BadHalfLife");
      await expect(
        router.connect(owner).setFeeConfig(HALF_LIFE, 10001, true)
      ).to.be.revertedWithCustomError(router, "FeeTooLarge");
    });

    it("cannot re-run the fast-path initializer", async function () {
      const { router, owner, bond, treasury, safe } = await deployFixture();
      await expect(
        router.connect(owner).initializeFastPath(
          HALF_LIFE, FEE_BPS, await bond.getAddress(), BOND, treasury.address, TTL, [safe.address]
        )
      ).to.be.revertedWithCustomError(router, "InvalidInitialization");
    });
  });
});

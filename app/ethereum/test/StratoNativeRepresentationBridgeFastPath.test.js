const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * The solver fast path on the representation bridge.
 *
 * The design claim under test: the attestation is UNCHANGED in everything that
 * governs whether a mint may happen, still names the original recipient, and is
 * still signed by the same signers and executed by the same Safe -- and the
 * contract, not the signers, redirects the mint to whoever fronted the
 * recipient's tokens. A solver therefore cannot be blessed, only checked.
 */
describe("StratoNativeRepresentationBridge fast path", function () {
  const HALF_LIFE = 21600n; // six hours
  const FEE_BPS = 500n; // 5%
  const BOND = 10n * 10n ** 18n;
  const TTL = 7n * 86400n;

  const SOURCE_CHAIN_ID = 2001n;
  const SOURCE_WITHDRAWAL_ID = 17n;
  const AMOUNT = 1000n * 10n ** 18n;
  const MAX_FEE = 30n * 10n ** 18n; // 3%

  const attestationV2Types = {
    NativeMintAttestationV2: [
      { name: "sourceChainId", type: "uint256" },
      { name: "sourceBridge", type: "address" },
      { name: "destinationChainId", type: "uint256" },
      { name: "destinationBridge", type: "address" },
      { name: "sourceWithdrawalId", type: "uint256" },
      { name: "stratoToken", type: "address" },
      { name: "representationToken", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "notBefore", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "requestedAt", type: "uint256" },
      { name: "feeHalfLife", type: "uint256" },
    ],
  };

  const attestationV1Types = {
    NativeMintAttestation: attestationV2Types.NativeMintAttestationV2.slice(0, 11),
  };

  async function fixture() {
    const [admin, user, signer, mintExecutor, solverA, solverB, announcer, treasury] =
      await ethers.getSigners();

    const token = await upgrades.deployProxy(
      await ethers.getContractFactory("StratoNativeRepresentationToken"),
      ["Wrapped STRATO", "wSTRATO", admin.address],
      { initializer: "initialize" }
    );
    const bridge = await upgrades.deployProxy(
      await ethers.getContractFactory("StratoNativeRepresentationBridge"),
      [admin.address],
      { initializer: "initialize" }
    );
    const bond = await (
      await ethers.getContractFactory("MockFastPathToken")
    ).deploy("Bond", "BOND", 18);
    const feeMath = await (
      await ethers.getContractFactory("BridgeFeeDecayHarness")
    ).deploy();

    await token.grantRole(await token.BRIDGE_ROLE(), await bridge.getAddress());
    await token.setTransferEndpoint(await bridge.getAddress(), true);

    const stratoToken = ethers.Wallet.createRandom().address;
    const sourceBridge = ethers.Wallet.createRandom().address;
    await bridge.setTokenMapping(stratoToken, await token.getAddress());
    await bridge.setAttestationSigner(signer.address, true);
    await bridge.setAttestationThreshold(1);
    await bridge.grantRole(await bridge.MINT_EXECUTOR_ROLE(), mintExecutor.address);

    await bridge.initializeFastPath(
      HALF_LIFE, FEE_BPS, await bond.getAddress(), BOND, treasury.address, TTL
    );

    // Solvers hold representation-token inventory to front with. They earned it
    // the ordinary way in production; here it is minted directly.
    await token.grantRole(await token.BRIDGE_ROLE(), admin.address);
    for (const who of [solverA, solverB]) {
      await token.connect(admin).mint(who.address, AMOUNT * 5n);
      await token.connect(who).approve(await bridge.getAddress(), AMOUNT * 5n);
    }
    await bond.mint(announcer.address, BOND * 5n);
    await bond.connect(announcer).approve(await bridge.getAddress(), BOND * 5n);

    return {
      admin, user, signer, mintExecutor, solverA, solverB, announcer, treasury,
      token, bridge, bond, feeMath, stratoToken, sourceBridge,
    };
  }

  async function termsFor(ctx, overrides = {}) {
    return {
      sourceChainId: SOURCE_CHAIN_ID,
      sourceBridge: ctx.sourceBridge,
      withdrawalId: SOURCE_WITHDRAWAL_ID,
      stratoToken: ctx.stratoToken,
      representationToken: await ctx.token.getAddress(),
      recipient: ctx.user.address,
      amount: AMOUNT,
      maxFee: MAX_FEE,
      requestedAt: BigInt(await time.latest()) + 60n,
      feeHalfLife: HALF_LIFE,
      ...overrides,
    };
  }

  /// Build the V2 attestation that corresponds to a set of terms. The signers'
  /// job is exactly this: copy STRATO's record, including the fee schedule.
  async function attestationFor(ctx, terms, overrides = {}) {
    const network = await ethers.provider.getNetwork();
    const now = BigInt(await time.latest());
    return {
      sourceChainId: terms.sourceChainId,
      sourceBridge: terms.sourceBridge,
      destinationChainId: network.chainId,
      destinationBridge: await ctx.bridge.getAddress(),
      sourceWithdrawalId: terms.withdrawalId,
      stratoToken: terms.stratoToken,
      representationToken: terms.representationToken,
      recipient: terms.recipient,
      amount: terms.amount,
      notBefore: now,
      deadline: now + 3600n,
      maxFee: terms.maxFee,
      requestedAt: terms.requestedAt,
      feeHalfLife: terms.feeHalfLife,
      ...overrides,
    };
  }

  async function signV2(ctx, attestation) {
    const network = await ethers.provider.getNetwork();
    return ctx.signer.signTypedData(
      {
        name: "StratoNativeRepresentationBridge",
        version: "1",
        chainId: network.chainId,
        verifyingContract: await ctx.bridge.getAddress(),
      },
      attestationV2Types,
      attestation
    );
  }

  async function signV1(ctx, attestation) {
    const network = await ethers.provider.getNetwork();
    const { maxFee, requestedAt, feeHalfLife, ...v1 } = attestation;
    return [
      v1,
      await ctx.signer.signTypedData(
        {
          name: "StratoNativeRepresentationBridge",
          version: "1",
          chainId: network.chainId,
          verifyingContract: await ctx.bridge.getAddress(),
        },
        attestationV1Types,
        v1
      ),
    ];
  }

  async function fillRungZero(ctx, solver, terms, opts = {}) {
    const at = opts.at ?? terms.requestedAt;
    const expectedFee = opts.expectedFee ?? terms.maxFee;
    await time.setNextBlockTimestamp(at);
    return ctx.bridge
      .connect(solver)
      .fillWithdrawal(terms, expectedFee, opts.transferable ?? false, opts.exitFee ?? 0);
  }

  // ----------------------------------------------------------- redemptions

  describe("fee-bearing redemptions", function () {
    it("commits the fee, the request time and the half-life in the log", async function () {
      const ctx = await fixture();
      await ctx.token.connect(ctx.admin).mint(ctx.user.address, AMOUNT);
      await ctx.token.connect(ctx.user).approve(await ctx.bridge.getAddress(), AMOUNT);

      const receipt = await (
        await ctx.bridge
          .connect(ctx.user)
          .requestRedemptionWithFee(
            await ctx.token.getAddress(), AMOUNT, ctx.user.address, MAX_FEE
          )
      ).wait();

      const event = receipt.logs
        .map((log) => { try { return ctx.bridge.interface.parseLog(log); } catch { return null; } })
        .filter(Boolean)
        .find((e) => e.name === "RedemptionRequestedWithFee");

      expect(event.args.maxFee).to.equal(MAX_FEE);
      expect(event.args.feeHalfLife).to.equal(HALF_LIFE);
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      expect(event.args.requestedAt).to.equal(BigInt(block.timestamp));
      expect(await ctx.token.totalSupply()).to.equal(AMOUNT * 10n);
    });

    it("refuses a fee over the ceiling, and leaves the fee-free path alone", async function () {
      const ctx = await fixture();
      await ctx.token.connect(ctx.admin).mint(ctx.user.address, AMOUNT * 2n);
      await ctx.token.connect(ctx.user).approve(await ctx.bridge.getAddress(), AMOUNT * 2n);

      await expect(
        ctx.bridge.connect(ctx.user).requestRedemptionWithFee(
          await ctx.token.getAddress(), AMOUNT, ctx.user.address, AMOUNT / 10n
        )
      ).to.be.revertedWithCustomError(ctx.bridge, "FeeTooLarge");

      await expect(
        ctx.bridge.connect(ctx.user).requestRedemption(
          await ctx.token.getAddress(), AMOUNT, ctx.user.address
        )
      ).to.emit(ctx.bridge, "RedemptionRequested");
    });
  });

  // ------------------------------------------------- the mint honours claims

  describe("the V2 mint honours claims", function () {
    it("mints to the recipient when nobody claimed", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);

      const before = await ctx.token.balanceOf(ctx.user.address);
      await ctx.bridge
        .connect(ctx.mintExecutor)
        .mintRepresentationWithAttestationV2(attestation, [await signV2(ctx, attestation)]);
      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(before + AMOUNT);
    });

    /**
     * The whole point: the attestation is built and signed WITHOUT knowing
     * whether anybody will claim, names the original recipient, and still pays
     * the solver. No signer ever sees a fill.
     */
    it("mints to the claimant from an attestation that names the recipient", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);
      const signature = await signV2(ctx, attestation);

      const userBefore = await ctx.token.balanceOf(ctx.user.address);
      const solverBefore = await ctx.token.balanceOf(ctx.solverA.address);

      await fillRungZero(ctx, ctx.solverA, terms);
      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(
        userBefore + AMOUNT - MAX_FEE
      );

      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(attestation, [signature])
      ).to.emit(ctx.bridge, "WithdrawalClaimSettled");

      // Net for the solver is exactly the fee they earned.
      expect(await ctx.token.balanceOf(ctx.solverA.address)).to.equal(solverBefore + MAX_FEE);
      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(
        userBefore + AMOUNT - MAX_FEE
      );
    });

    it("mints to the last rung of the ladder", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);
      const exitFee = 10n * 10n ** 18n;

      const aBefore = await ctx.token.balanceOf(ctx.solverA.address);
      const bBefore = await ctx.token.balanceOf(ctx.solverB.address);

      await fillRungZero(ctx, ctx.solverA, terms, { transferable: true, exitFee });
      await ctx.bridge.connect(ctx.solverB).fillWithdrawal(terms, exitFee, false, 0);

      await ctx.bridge
        .connect(ctx.mintExecutor)
        .mintRepresentationWithAttestationV2(attestation, [await signV2(ctx, attestation)]);

      // A fronted 970 and was bought out at 990: it keeps 20. B paid 990 and is
      // minted 1000, keeping the 10 it asked for.
      expect(await ctx.token.balanceOf(ctx.solverA.address)).to.equal(
        aBefore + MAX_FEE - exitFee
      );
      expect(await ctx.token.balanceOf(ctx.solverB.address)).to.equal(bBefore + exitFee);
    });

    /**
     * A solver cannot name their own fee. The schedule in the attestation is
     * what STRATO committed, and a claim priced against anything else is void:
     * the recipient is minted to, the liar keeps nothing, and the token's
     * supply still matches what STRATO locked.
     */
    it("voids a claim priced against a schedule the signers did not attest", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      // The solver claims the user offered a 5% fee when the real record says 3%.
      const inflated = { ...terms, maxFee: 50n * 10n ** 18n };
      const attestation = await attestationFor(ctx, terms);

      await fillRungZero(ctx, ctx.solverA, inflated);
      const userAfterFill = await ctx.token.balanceOf(ctx.user.address);
      const solverAfterFill = await ctx.token.balanceOf(ctx.solverA.address);

      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(attestation, [await signV2(ctx, attestation)])
      ).to.emit(ctx.bridge, "WithdrawalClaimVoided");

      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(userAfterFill + AMOUNT);
      expect(await ctx.token.balanceOf(ctx.solverA.address)).to.equal(solverAfterFill);
    });

    it("refuses a fee schedule the origin could never have committed", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);

      const overFee = await attestationFor(ctx, terms, { maxFee: AMOUNT });
      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(overFee, [await signV2(ctx, overFee)])
      ).to.be.revertedWithCustomError(ctx.bridge, "FeeTooLarge");

      const badHalfLife = await attestationFor(ctx, terms, { feeHalfLife: 259201n });
      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(badHalfLife, [await signV2(ctx, badHalfLife)])
      ).to.be.revertedWithCustomError(ctx.bridge, "BadHalfLife");
    });

    it("keeps every V1 gate: signer threshold, notBefore, deadline, route", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);

      const unsigned = await attestationFor(ctx, terms);
      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(unsigned, [await signV2(ctx, { ...unsigned, amount: 1n })])
      ).to.be.revertedWithCustomError(ctx.bridge, "BadAttestationSignatures");

      const notYet = await attestationFor(ctx, terms, {
        notBefore: BigInt(await time.latest()) + 5000n,
        deadline: BigInt(await time.latest()) + 6000n,
      });
      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(notYet, [await signV2(ctx, notYet)])
      ).to.be.revertedWithCustomError(ctx.bridge, "AttestationNotReady");

      const signed = await attestationFor(ctx, terms);
      const signature = await signV2(ctx, signed);
      await expect(
        ctx.bridge.connect(ctx.solverA).mintRepresentationWithAttestationV2(signed, [signature])
      ).to.be.revertedWithCustomError(ctx.bridge, "AccessControlUnauthorizedAccount");
    });

    it("mints once, and refuses a claim afterwards", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);
      const signature = await signV2(ctx, attestation);

      await ctx.bridge
        .connect(ctx.mintExecutor)
        .mintRepresentationWithAttestationV2(attestation, [signature]);

      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestationV2(attestation, [signature])
      ).to.be.revertedWithCustomError(ctx.bridge, "DuplicateMint");
      await expect(
        ctx.bridge.connect(ctx.solverA).fillWithdrawal(terms, MAX_FEE, false, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "DuplicateMint");
    });

    /**
     * A V1 attestation carries no schedule, so there is nothing to check a
     * claim against. Minting to the recipient anyway would pay them twice --
     * once by the solver, once by the mint -- and strand the solver, so a
     * claimed withdrawal has to go through V2.
     */
    it("refuses the V1 mint once a claim exists", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);

      const [v1, v1Signature] = await signV1(ctx, attestation);
      await fillRungZero(ctx, ctx.solverA, terms);

      await expect(
        ctx.bridge
          .connect(ctx.mintExecutor)
          .mintRepresentationWithAttestation(v1, [v1Signature])
      ).to.be.revertedWithCustomError(ctx.bridge, "ClaimExists");
    });

    it("still runs the V1 mint when nothing was claimed", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);
      const [v1, v1Signature] = await signV1(ctx, attestation);

      const before = await ctx.token.balanceOf(ctx.user.address);
      await ctx.bridge
        .connect(ctx.mintExecutor)
        .mintRepresentationWithAttestation(v1, [v1Signature]);
      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(before + AMOUNT);
    });
  });

  // ------------------------------------------------------------ the ladder

  describe("claim ladder", function () {
    it("decays the rung-zero fee with real elapsed time", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);

      const before = await ctx.token.balanceOf(ctx.user.address);
      const expectedFee = MAX_FEE / 2n;
      await fillRungZero(ctx, ctx.solverA, terms, {
        at: terms.requestedAt + HALF_LIFE,
        expectedFee,
      });
      expect(await ctx.token.balanceOf(ctx.user.address)).to.equal(
        before + AMOUNT - expectedFee
      );
    });

    it("keeps a claim its holder has not put up for sale", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);

      await fillRungZero(ctx, ctx.solverA, terms);
      await expect(
        ctx.bridge.connect(ctx.solverB).fillWithdrawal(terms, 0, false, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "NotTransferable");
    });

    it("lets a holder reprice, withdraw, and refuse a stale taker", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const first = 10n * 10n ** 18n;
      const second = 20n * 10n ** 18n;

      await fillRungZero(ctx, ctx.solverA, terms, { transferable: true, exitFee: first });
      // Upward repricing helps the taker, so the floor allows it; cutting the
      // price after they committed is what it refuses.
      await ctx.bridge.connect(ctx.solverA).setWithdrawalClaimExitOffer(terms, true, second);
      await ctx.bridge.connect(ctx.solverA).setWithdrawalClaimExitOffer(terms, true, first / 2n);

      await expect(
        ctx.bridge.connect(ctx.solverB).fillWithdrawal(terms, first, false, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "FeeBelowMinimum");

      await ctx.bridge.connect(ctx.solverA).setWithdrawalClaimExitOffer(terms, false, 0);
      await expect(
        ctx.bridge.connect(ctx.solverB).fillWithdrawal(terms, first / 2n, false, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "NotTransferable");

      await expect(
        ctx.bridge.connect(ctx.solverB).setWithdrawalClaimExitOffer(terms, true, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "InvalidAddress");
    });

    it("refuses a claim on a disabled route", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      await ctx.bridge.disableTokenMapping(ctx.stratoToken);

      await expect(
        ctx.bridge.connect(ctx.solverA).fillWithdrawal(terms, MAX_FEE, false, 0)
      ).to.be.revertedWithCustomError(ctx.bridge, "RouteDisabled");
    });

    it("leaves the token's supply exactly equal to what STRATO locked", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      const attestation = await attestationFor(ctx, terms);
      const exitFee = 10n * 10n ** 18n;

      const supplyBefore = await ctx.token.totalSupply();

      // Two rungs of solver-to-solver transfers move only existing supply.
      await fillRungZero(ctx, ctx.solverA, terms, { transferable: true, exitFee });
      await ctx.bridge.connect(ctx.solverB).fillWithdrawal(terms, exitFee, false, 0);
      expect(await ctx.token.totalSupply()).to.equal(supplyBefore);

      await ctx.bridge
        .connect(ctx.mintExecutor)
        .mintRepresentationWithAttestationV2(attestation, [await signV2(ctx, attestation)]);

      // And the mint adds exactly the amount, once.
      expect(await ctx.token.totalSupply()).to.equal(supplyBefore + AMOUNT);
    });
  });

  // ------------------------------------------------------- announcements

  describe("bonded announcements", function () {
    it("takes a bond and returns it on confirmation", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);

      const before = await ctx.bond.balanceOf(ctx.announcer.address);
      await expect(ctx.bridge.connect(ctx.announcer).announceWithdrawal(terms))
        .to.emit(ctx.bridge, "WithdrawalAnnounced");
      expect(await ctx.bond.balanceOf(ctx.announcer.address)).to.equal(before - BOND);

      const key = await ctx.bridge.withdrawalKeyFor(
        terms.sourceChainId, terms.sourceBridge, terms.withdrawalId
      );
      await ctx.bridge.connect(ctx.admin).confirmAnnouncement(key);
      expect(await ctx.bond.balanceOf(ctx.announcer.address)).to.equal(before);
    });

    it("lets the announcer reclaim after the ttl, and slashes only on rejection", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      await ctx.bridge.connect(ctx.announcer).announceWithdrawal(terms);
      const key = await ctx.bridge.withdrawalKeyFor(
        terms.sourceChainId, terms.sourceBridge, terms.withdrawalId
      );

      await expect(
        ctx.bridge.connect(ctx.announcer).reclaimAnnouncementBond(key)
      ).to.be.revertedWithCustomError(ctx.bridge, "BondNotReclaimable");

      await expect(
        ctx.bridge.connect(ctx.solverA).rejectAnnouncement(key)
      ).to.be.revertedWithCustomError(ctx.bridge, "AccessControlUnauthorizedAccount");

      const treasuryBefore = await ctx.bond.balanceOf(ctx.treasury.address);
      await ctx.bridge.connect(ctx.admin).rejectAnnouncement(key);
      expect(await ctx.bond.balanceOf(ctx.treasury.address)).to.equal(treasuryBefore + BOND);
    });

    it("keeps live bonds out of reach of the sweep", async function () {
      const ctx = await fixture();
      const terms = await termsFor(ctx);
      await ctx.bridge.connect(ctx.announcer).announceWithdrawal(terms);
      await ctx.bond.mint(await ctx.bridge.getAddress(), 5n * 10n ** 18n);

      await ctx.bridge
        .connect(ctx.admin)
        .sweepUnbonded(await ctx.bond.getAddress(), ctx.treasury.address);
      expect(await ctx.bond.balanceOf(ctx.treasury.address)).to.equal(5n * 10n ** 18n);
      expect(await ctx.bond.balanceOf(await ctx.bridge.getAddress())).to.equal(BOND);
    });
  });

  // --------------------------------------------------------------- switches

  describe("switches fail closed", function () {
    it("refuses fills and announcements before the fast path is configured", async function () {
      const [admin, user, signer, mintExecutor, solverA] = await ethers.getSigners();
      const token = await upgrades.deployProxy(
        await ethers.getContractFactory("StratoNativeRepresentationToken"),
        ["Wrapped STRATO", "wSTRATO", admin.address],
        { initializer: "initialize" }
      );
      const bridge = await upgrades.deployProxy(
        await ethers.getContractFactory("StratoNativeRepresentationBridge"),
        [admin.address],
        { initializer: "initialize" }
      );
      const stratoToken = ethers.Wallet.createRandom().address;
      await bridge.setTokenMapping(stratoToken, await token.getAddress());

      const terms = {
        sourceChainId: SOURCE_CHAIN_ID,
        sourceBridge: ethers.Wallet.createRandom().address,
        withdrawalId: SOURCE_WITHDRAWAL_ID,
        stratoToken,
        representationToken: await token.getAddress(),
        recipient: user.address,
        amount: AMOUNT,
        maxFee: 0n,
        requestedAt: BigInt(await time.latest()),
        feeHalfLife: HALF_LIFE,
      };

      await expect(
        bridge.connect(solverA).fillWithdrawal(terms, 0, false, 0)
      ).to.be.revertedWithCustomError(bridge, "FillsDisabled");
      await expect(
        bridge.connect(solverA).announceWithdrawal(terms)
      ).to.be.revertedWithCustomError(bridge, "AnnouncementsDisabled");
    });

    it("cannot re-run the fast-path initializer", async function () {
      const ctx = await fixture();
      await expect(
        ctx.bridge
          .connect(ctx.admin)
          .initializeFastPath(
            HALF_LIFE, FEE_BPS, await ctx.bond.getAddress(), BOND, ctx.treasury.address, TTL
          )
      ).to.be.revertedWithCustomError(ctx.bridge, "InvalidInitialization");
    });
  });
});

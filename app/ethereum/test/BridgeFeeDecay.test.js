const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * The solver fee schedule, pinned by value.
 *
 * THESE VECTORS ARE SHARED WITH STRATO. The same constants are asserted against
 * app/contracts/libraries/Bridge/BridgeFees.sol in
 * app/contracts/tests/Bridge/BridgeFastPath.test.sol
 * (it_fastpath_decay_matches_shared_vectors). A fill is settled on one chain
 * against a schedule committed on the other, so the two implementations
 * disagreeing is a fund-loss bug rather than a rounding difference. If a vector
 * here changes, the STRATO one has to change with it.
 */
describe("BridgeFeeDecay", function () {
  const WINDOW = 259200n; // three days
  const HALF_LIFE = 21600n; // six hours: twelve halvings across the window
  const FEE = 3n * 10n ** 18n;
  const T0 = 1_000_000n;

  async function deploy() {
    return (await ethers.getContractFactory("BridgeFeeDecayHarness")).deploy();
  }

  it("reproduces the shared decay vectors exactly", async function () {
    const lib = await deploy();

    expect(await lib.window()).to.equal(WINDOW);

    const cases = [
      ["at the request", T0, 3000000000000000000n],
      ["before the request, on clock skew", T0 - 500n, 3000000000000000000n],
      ["one half-life in", T0 + HALF_LIFE, 1500000000000000000n],
      ["two half-lives in", T0 + 2n * HALF_LIFE, 750000000000000000n],
      ["halfway through a half-life", T0 + HALF_LIFE / 2n, 2250000000000000000n],
      ["one second in", T0 + 1n, 2999930555555555555n],
      ["one second before the window closes", T0 + 259199n, 732455783420138n],
      ["exactly at the window", T0 + WINDOW, 0n],
      ["long past the window", T0 + WINDOW + 1000000n, 0n],
    ];

    for (const [label, at, expected] of cases) {
      expect(await lib.decayedFee(FEE, T0, HALF_LIFE, at), label).to.equal(expected);
    }

    expect(await lib.decayedFee(0n, T0, HALF_LIFE, T0 + 10n), "no fee offered").to.equal(0n);
    expect(await lib.decayedFee(FEE, T0, 0n, T0 + 10n), "no half-life, no fee").to.equal(0n);
    expect(await lib.decayedFee(7n, T0, HALF_LIFE, T0 + 11n * HALF_LIFE), "a dust fee shifts away").to.equal(0n);
    expect(await lib.decayedFee(FEE, T0, 1n, T0 + 200n), "a one-second half-life is gone in minutes").to.equal(0n);
    expect(
      await lib.decayedFee(3n * 10n ** 6n, T0, HALF_LIFE, T0 + HALF_LIFE / 2n),
      "a six-decimal token scales the same way"
    ).to.equal(2250000n);
  });

  it("never increases, and reaches exactly zero at the window", async function () {
    const lib = await deploy();

    let previous = FEE + 1n;
    for (let elapsed = 0n; elapsed < WINDOW; elapsed += 617n) {
      const current = await lib.decayedFee(FEE, T0, HALF_LIFE, T0 + elapsed);
      expect(current, `elapsed ${elapsed}`).to.be.lte(previous);
      expect(current, `elapsed ${elapsed}`).to.be.lte(FEE);
      expect(current, `elapsed ${elapsed}`).to.be.gt(0n);
      previous = current;
    }
    expect(await lib.decayedFee(FEE, T0, HALF_LIFE, T0 + WINDOW)).to.equal(0n);
  });

  it("halves exactly at every half-life boundary, then the window truncates", async function () {
    const lib = await deploy();

    // Eleven clean halvings inside the window.
    let expected = FEE;
    for (let n = 0n; n <= 11n; n++) {
      expect(
        await lib.decayedFee(FEE, T0, HALF_LIFE, T0 + n * HALF_LIFE),
        `halving ${n}`
      ).to.equal(expected);
      expected /= 2n;
    }

    // The twelfth boundary IS the window. Left to the geometric series the fee
    // would still be maxFee/4096 -- a real amount a solver could collect three
    // days late -- and the window is what makes the user's "decays to zero"
    // guarantee literal rather than asymptotic.
    expect(expected).to.equal(FEE / 4096n);
    expect(await lib.decayedFee(FEE, T0, HALF_LIFE, T0 + 12n * HALF_LIFE)).to.equal(0n);
    expect(12n * HALF_LIFE).to.equal(WINDOW);
  });

  /**
   * The deduction is rounded UP, so truncation can only ever move the fee down
   * and the recipient's net up. A rounding rule has to point somewhere; this
   * asserts it points away from the party that chose to be here.
   */
  it("rounds the deduction against the solver", async function () {
    const lib = await deploy();

    // A fee of 3 with a 100s half-life, 1s in: the true value is 3 * 2^(-0.01),
    // and the linear model gives 3 - ceil(3*1/200) = 3 - 1 = 2.
    expect(await lib.decayedFee(3n, T0, 100n, T0 + 1n)).to.equal(2n);
    // Never above the ceiling, whatever the rounding.
    for (let i = 1n; i <= 50n; i++) {
      expect(await lib.decayedFee(101n, T0, 100n, T0 + i)).to.be.lte(101n);
    }
  });

  it("bounds the fee ceiling and the half-life", async function () {
    const lib = await deploy();
    const hundred = 100n * 10n ** 18n;

    expect(await lib.isFeeCapAllowed(0n, hundred, 500n), "a zero fee is always fine").to.equal(true);
    expect(await lib.isFeeCapAllowed(5n * 10n ** 18n, hundred, 500n), "5% under a 5% ceiling").to.equal(true);
    expect(await lib.isFeeCapAllowed(6n * 10n ** 18n, hundred, 500n), "6% over a 5% ceiling").to.equal(false);
    expect(await lib.isFeeCapAllowed(1n, hundred, 0n), "a zero ceiling refuses everything").to.equal(false);
    expect(await lib.isFeeCapAllowed(hundred, hundred, 10000n), "a fee equal to the amount leaves nothing").to.equal(false);
    expect(await lib.isFeeCapAllowed(1n, 0n, 10000n), "a zero amount cannot carry a fee").to.equal(false);

    expect(await lib.isHalfLifeAllowed(1n)).to.equal(true);
    expect(await lib.isHalfLifeAllowed(WINDOW)).to.equal(true);
    expect(await lib.isHalfLifeAllowed(0n), "zero would be a cliff").to.equal(false);
    expect(await lib.isHalfLifeAllowed(WINDOW + 1n), "longer than the window is the same cliff").to.equal(false);
  });

  /// A maxFee large enough to overflow a naive `fee * remainder` must still
  /// compute, which is why the reduction is split into quotient and remainder.
  it("survives an absurd fee without overflowing", async function () {
    const lib = await deploy();
    const huge = (1n << 255n) - 1n;

    const atStart = await lib.decayedFee(huge, T0, HALF_LIFE, T0);
    expect(atStart).to.equal(huge);

    const midway = await lib.decayedFee(huge, T0, HALF_LIFE, T0 + HALF_LIFE / 2n);
    expect(midway).to.be.lt(huge);
    expect(midway).to.be.gt(huge / 2n);
    expect(await lib.decayedFee(huge, T0, HALF_LIFE, T0 + WINDOW)).to.equal(0n);
  });
});

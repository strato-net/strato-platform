const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Guards on the two live UUPS proxies that the fast path upgrades in place.
 *
 * These are the checks that cannot be made by reading the diff. Both contracts
 * are deployed and hold real routes, so a reordered storage slot or an
 * over-limit implementation is not a failed test -- it is a bricked bridge.
 */
describe("bridge upgrade safety", function () {
  const EIP170_LIMIT = 24576;

  /**
   * The storage layout must stay append-only against the DEPLOYED version.
   *
   * The frozen copies under contracts/test/legacy are exactly what is running
   * on chain today; they exist for this comparison and are never deployed. When
   * one of these contracts is upgraded for real, refresh its frozen copy to the
   * newly deployed version so the next change is diffed against reality.
   */
  it("keeps the deployed storage layouts intact", async function () {
    for (const [deployed, next] of [
      ["DepositRouterLegacyV3", "DepositRouter"],
      ["StratoNativeRepresentationBridgeLegacyV1", "StratoNativeRepresentationBridge"],
    ]) {
      await upgrades.validateUpgrade(
        await ethers.getContractFactory(deployed),
        await ethers.getContractFactory(next),
        { kind: "uups" }
      );
    }
  });

  /**
   * An implementation over EIP-170 cannot be deployed at all, and the failure
   * shows up at deploy time on a real network rather than in review.
   * StratoNativeRepresentationBridge runs close to the limit, so this is a
   * live constraint rather than a formality.
   */
  it("keeps both implementations inside the EIP-170 limit", async function () {
    for (const name of ["DepositRouter", "StratoNativeRepresentationBridge"]) {
      const artifact = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, `../artifacts/contracts/bridge/${name}.sol/${name}.json`)
        )
      );
      const size = (artifact.deployedBytecode.length - 2) / 2;
      expect(size, `${name} deployed bytecode`).to.be.lte(EIP170_LIMIT);
    }
  });

  /// The two fee libraries have to agree, so neither may be edited alone. This
  /// pins the shape rather than the text: both expose the same window.
  it("agrees on the decay window across both chains", async function () {
    const lib = await (await ethers.getContractFactory("BridgeFeeDecayHarness")).deploy();
    expect(await lib.window()).to.equal(259200n);

    const stratoSource = fs.readFileSync(
      path.join(__dirname, "../../contracts/libraries/Bridge/BridgeFees.sol"),
      "utf8"
    );
    expect(stratoSource, "STRATO's BridgeFees window").to.contain(
      "DECAY_WINDOW_SECONDS = 259200"
    );
    expect(stratoSource, "STRATO's BridgeFees halving cap").to.contain("MAX_HALVINGS = 128");
  });
});

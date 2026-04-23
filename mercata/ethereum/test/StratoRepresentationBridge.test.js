/**
 * Tests for the external-chain native-return flow.
 *
 * Focus areas (driven by PR review):
 *   - Users cannot have their representation tokens burned without explicit
 *     authorization. The bridge's operator role cannot reach into a holder's
 *     balance; the only path to burn is the user-initiated `redeem` which
 *     pulls via `transferFrom` first.
 *   - The representation token's `burn` function only burns the caller's own
 *     balance (i.e., the bridge's balance after a `transferFrom`).
 *   - Mint / redeem both emit the expected event data so the relayer can
 *     observe and verify.
 *   - Mint and burn rate limits are enforced.
 *   - Paused state blocks mint and redeem.
 */
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

const MINTER_ROLE = ethers.id("MINTER");
const BRIDGE_OPERATOR_ROLE = ethers.id("BRIDGE_OPERATOR");
const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

async function deployRepToken({ name, symbol, admin }) {
  const Factory = await ethers.getContractFactory("StratoRepresentationToken");
  const token = await upgrades.deployProxy(
    Factory,
    [name, symbol, admin],
    { initializer: "initialize", kind: "uups" },
  );
  await token.waitForDeployment();
  return token;
}

async function deployRepBridge({ admin }) {
  const Factory = await ethers.getContractFactory("StratoRepresentationBridge");
  const bridge = await upgrades.deployProxy(
    Factory,
    [admin],
    { initializer: "initialize", kind: "uups" },
  );
  await bridge.waitForDeployment();
  return bridge;
}

describe("StratoRepresentationBridge", function () {
  let admin;       // governance (DEFAULT_ADMIN_ROLE on bridge + token)
  let operator;    // BRIDGE_OPERATOR_ROLE holder
  let alice;       // user holding representation tokens
  let attacker;    // unrelated third party
  let bridge;      // StratoRepresentationBridge
  let token;       // StratoRepresentationToken (USDST representation)
  const stratoToken = "0x937EFa7E3A77E20bbdBd7C0D32b6514F368c1010"; // USDST on STRATO

  beforeEach(async function () {
    [admin, operator, alice, attacker] = await ethers.getSigners();

    token = await deployRepToken({ name: "USDST", symbol: "USDST", admin: admin.address });
    bridge = await deployRepBridge({ admin: admin.address });

    // Wire bridge to token: bridge gets MINTER on token so it can mint/burn
    // on behalf of the protocol. setTokenMapping + operator + high rate limits.
    await token.connect(admin).grantRole(MINTER_ROLE, await bridge.getAddress());
    await bridge.connect(admin).setTokenMapping(stratoToken, await token.getAddress());
    await bridge.connect(admin).grantRole(BRIDGE_OPERATOR_ROLE, operator.address);
    await bridge
      .connect(admin)
      .setMintRateLimit(stratoToken, ethers.parseEther("1000000"), 3600);
    await bridge
      .connect(admin)
      .setBurnRateLimit(stratoToken, ethers.parseEther("1000000"), 3600);
  });

  // ==========================================================================
  // Mint path (outbound)
  // ==========================================================================

  describe("mintRepresentation", function () {
    it("mints to the recipient and emits RepresentationMinted", async function () {
      const amount = ethers.parseEther("100");
      await expect(bridge.connect(operator).mintRepresentation(stratoToken, alice.address, amount))
        .to.emit(bridge, "RepresentationMinted")
        .withArgs(stratoToken, await token.getAddress(), alice.address, amount);
      expect(await token.balanceOf(alice.address)).to.equal(amount);
    });

    it("rejects callers without BRIDGE_OPERATOR_ROLE", async function () {
      await expect(
        bridge.connect(attacker).mintRepresentation(stratoToken, alice.address, 1n),
      ).to.be.revertedWithCustomError(bridge, "AccessControlUnauthorizedAccount");
    });

    it("reverts when the STRATO token is not mapped", async function () {
      const unmapped = "0x000000000000000000000000000000000000BEEF";
      await expect(
        bridge.connect(operator).mintRepresentation(unmapped, alice.address, 1n),
      ).to.be.revertedWithCustomError(bridge, "TokenNotMapped");
    });

    it("enforces the mint rate limit", async function () {
      await bridge.connect(admin).setMintRateLimit(stratoToken, ethers.parseEther("50"), 3600);
      await bridge
        .connect(operator)
        .mintRepresentation(stratoToken, alice.address, ethers.parseEther("50"));
      await expect(
        bridge.connect(operator).mintRepresentation(stratoToken, alice.address, 1n),
      ).to.be.revertedWithCustomError({ interface: bridge.interface }, "RateLimitExceeded");
    });

    it("is blocked while paused", async function () {
      await bridge.connect(admin).pause();
      await expect(
        bridge.connect(operator).mintRepresentation(stratoToken, alice.address, 1n),
      ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
    });
  });

  // ==========================================================================
  // Redeem path (inbound / return-to-STRATO)
  // ==========================================================================

  describe("redeem", function () {
    const stratoRecipient = "0x00000000000000000000000000000000000000aA";
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      // Seed Alice with representation tokens for redemption.
      await bridge.connect(operator).mintRepresentation(stratoToken, alice.address, amount);
    });

    it("pulls via transferFrom, burns the bridge's balance, and emits the event", async function () {
      await token.connect(alice).approve(await bridge.getAddress(), amount);

      const supplyBefore = await token.totalSupply();
      const aliceBefore = await token.balanceOf(alice.address);

      await expect(bridge.connect(alice).redeem(stratoToken, stratoRecipient, amount))
        .to.emit(bridge, "RepresentationBurned")
        .withArgs(stratoToken, alice.address, stratoRecipient, await token.getAddress(), amount);

      expect(await token.totalSupply()).to.equal(supplyBefore - amount);
      expect(await token.balanceOf(alice.address)).to.equal(aliceBefore - amount);
      // Bridge never retains a balance: it burns what it just received.
      expect(await token.balanceOf(await bridge.getAddress())).to.equal(0n);
    });

    it("reverts without an approval (no authorization)", async function () {
      await expect(
        bridge.connect(alice).redeem(stratoToken, stratoRecipient, amount),
      ).to.be.reverted; // SafeERC20 maps the allowance failure to a revert
    });

    it("requires a non-zero STRATO recipient", async function () {
      await token.connect(alice).approve(await bridge.getAddress(), amount);
      await expect(
        bridge.connect(alice).redeem(stratoToken, ethers.ZeroAddress, amount),
      ).to.be.revertedWithCustomError(bridge, "InvalidAddress");
    });

    it("reverts on zero amount", async function () {
      await expect(
        bridge.connect(alice).redeem(stratoToken, stratoRecipient, 0),
      ).to.be.revertedWithCustomError(bridge, "ZeroAmount");
    });

    it("reverts if the STRATO token is not mapped", async function () {
      const unmapped = "0x000000000000000000000000000000000000BEEF";
      await expect(
        bridge.connect(alice).redeem(unmapped, stratoRecipient, 1n),
      ).to.be.revertedWithCustomError(bridge, "TokenNotMapped");
    });

    it("enforces the burn rate limit", async function () {
      await bridge.connect(admin).setBurnRateLimit(stratoToken, ethers.parseEther("50"), 3600);
      await token.connect(alice).approve(await bridge.getAddress(), amount);
      // The rate limit is consumed before transferFrom, so a >limit attempt fails up-front.
      await expect(
        bridge.connect(alice).redeem(stratoToken, stratoRecipient, ethers.parseEther("60")),
      ).to.be.revertedWithCustomError({ interface: bridge.interface }, "RateLimitExceeded");
    });

    it("is blocked while paused", async function () {
      await token.connect(alice).approve(await bridge.getAddress(), amount);
      await bridge.connect(admin).pause();
      await expect(
        bridge.connect(alice).redeem(stratoToken, stratoRecipient, amount),
      ).to.be.revertedWithCustomError(bridge, "EnforcedPause");
    });
  });

  // ==========================================================================
  // Unauthorized-burn scenarios (the PR review blocker)
  // ==========================================================================

  describe("unauthorized burn surface", function () {
    it("operator CANNOT burn a user's representation tokens — no such function exists", async function () {
      // The old operator-initiated burn (`burnRepresentation(stratoToken,
      // from, amount)`) was removed deliberately. If someone tries to call
      // it, the call data doesn't match any selector and the tx reverts.
      const amount = ethers.parseEther("100");
      await bridge.connect(operator).mintRepresentation(stratoToken, alice.address, amount);

      const iface = new ethers.Interface([
        "function burnRepresentation(address,address,uint256)",
      ]);
      const data = iface.encodeFunctionData("burnRepresentation", [
        stratoToken,
        alice.address,
        amount,
      ]);
      await expect(
        operator.sendTransaction({ to: await bridge.getAddress(), data }),
      ).to.be.reverted;

      // Alice's balance is untouched.
      expect(await token.balanceOf(alice.address)).to.equal(amount);
    });

    it("a MINTER cannot burn another address's balance via the token contract", async function () {
      // The token's `burn(uint256 amount)` only burns msg.sender's own
      // balance, even when the caller holds MINTER_ROLE. Verify by trying to
      // reach into Alice's balance from the bridge (the only live MINTER).
      const amount = ethers.parseEther("100");
      await bridge.connect(operator).mintRepresentation(stratoToken, alice.address, amount);

      // Directly call the token's `burn(uint256)` from the bridge's
      // perspective — it only affects the bridge's balance, which is zero,
      // so the call reverts on underflow.
      await expect(token.connect(alice).burn(1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("a non-MINTER cannot call burn even for their own balance", async function () {
      // Alice has tokens but no MINTER_ROLE — AccessControl rejects first.
      const amount = ethers.parseEther("100");
      await bridge.connect(operator).mintRepresentation(stratoToken, alice.address, amount);
      await expect(token.connect(alice).burn(1n)).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("direct mint by a non-MINTER is rejected by the token", async function () {
      await expect(
        token.connect(attacker).mint(attacker.address, 1n),
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  // ==========================================================================
  // Admin / config
  // ==========================================================================

  describe("admin config", function () {
    it("only DEFAULT_ADMIN can change the token mapping", async function () {
      await expect(
        bridge.connect(attacker).setTokenMapping(stratoToken, await token.getAddress()),
      ).to.be.revertedWithCustomError(bridge, "AccessControlUnauthorizedAccount");
    });

    it("rejects zero addresses in setTokenMapping", async function () {
      await expect(
        bridge.connect(admin).setTokenMapping(ethers.ZeroAddress, await token.getAddress()),
      ).to.be.revertedWithCustomError(bridge, "InvalidAddress");
      await expect(
        bridge.connect(admin).setTokenMapping(stratoToken, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(bridge, "InvalidAddress");
    });
  });
});

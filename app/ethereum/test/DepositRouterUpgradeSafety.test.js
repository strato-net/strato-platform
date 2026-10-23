const { expect } = require("chai");
const { artifacts, ethers, upgrades } = require("hardhat");

describe("DepositRouter upgrade safety", function () {
  it("keeps the deployed V3 storage layout intact", async function () {
    await upgrades.validateUpgrade(
      await ethers.getContractFactory("DepositRouterLegacyV3"),
      await ethers.getContractFactory("DepositRouter"),
      { kind: "uups" }
    );
  });

  it("keeps both router implementations inside the EIP-170 limit", async function () {
    for (const name of ["DepositRouter", "ExternalAssetDepositRouter"]) {
      const artifact = await artifacts.readArtifact(name);
      const size = (artifact.deployedBytecode.length - 2) / 2;
      expect(size, `${name} deployed bytecode`).to.be.lte(24576);
    }
  });
});

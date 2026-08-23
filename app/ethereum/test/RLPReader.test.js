const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RLPReader", function () {
  let h;
  before(async function () {
    const H = await ethers.getContractFactory("RLPReaderHarness");
    h = await H.deploy();
    await h.waitForDeployment();
  });

  it("listLength matches a 14-element header", async function () {
    const v1 = "0x" + "12".repeat(20);
    const v2 = "0x" + "34".repeat(20);
    const enc = ethers.encodeRlp([
      "0x02",
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x65",
      "0x",
      "0x" + "00".repeat(32),
      [v1, v2],
      [],
      [],
      "0x",
      [],
    ]);
    expect(await h.listLength(enc)).to.equal(14n);
  });

  it("listLength matches a 14-element header with 7 validators", async function () {
    const validators = [];
    for (let i = 0; i < 7; i++) {
      validators.push("0x" + i.toString().padStart(40, "0"));
    }
    const enc = ethers.encodeRlp([
      "0x02",
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x" + "00".repeat(32),
      "0x65",
      "0x",
      "0x" + "00".repeat(32),
      validators,
      [],
      [],
      "0x",
      [],
    ]);
    expect(await h.listLength(enc)).to.equal(14n);
  });
});

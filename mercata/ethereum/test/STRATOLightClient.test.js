const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  encodeHeader,
  signCommit,
  quorumSigners,
  sortAddresses,
} = require("./helpers/strato");

/**
 * Tests for the STRATOLightClient.
 *
 * Each test starts from a fresh deployment with a deterministic validator
 * set, then drives `submitHeader` with synthetic V2 headers signed by some
 * subset of the validators.
 */

const ZERO32 = "0x" + "00".repeat(32);

async function deploy(genesisBlockNumber, validators) {
  const sorted = sortAddresses(validators.map((w) => w.address));
  const Client = await ethers.getContractFactory("STRATOLightClient");
  const [owner] = await ethers.getSigners();
  const client = await upgrades.deployProxy(
    Client,
    [owner.address, genesisBlockNumber, sorted],
    { kind: "uups" }
  );
  await client.waitForDeployment();
  return { client, owner, sortedValidators: sorted };
}

/** Create N validator wallets sorted ascending by address. */
function makeValidators(n) {
  const wallets = [];
  for (let i = 0; i < n; i++) {
    wallets.push(ethers.Wallet.createRandom());
  }
  // Sort by address so iteration order matches the on-chain commitment.
  return wallets.sort((a, b) =>
    BigInt(a.address) < BigInt(b.address) ? -1 : 1
  );
}

describe("STRATOLightClient", function () {
  describe("initialize", function () {
    it("installs the genesis validator set and sets tip", async function () {
      const validators = makeValidators(7);
      const { client } = await deploy(100, validators);

      expect(await client.tip()).to.equal(100n);
      expect(await client.validatorCount()).to.equal(7n);
      for (const v of validators) {
        expect(await client.isValidator(v.address)).to.be.true;
      }
    });

    it("rejects an unsorted genesis validator set", async function () {
      const validators = makeValidators(5);
      // Reverse the order to break ascending invariant.
      const unsorted = [...validators].reverse().map((v) => v.address);

      const Client = await ethers.getContractFactory("STRATOLightClient");
      const [owner] = await ethers.getSigners();

      await expect(
        upgrades.deployProxy(Client, [owner.address, 0, unsorted], {
          kind: "uups",
        })
      ).to.be.reverted;
    });

    it("rejects an empty validator set", async function () {
      const Client = await ethers.getContractFactory("STRATOLightClient");
      const [owner] = await ethers.getSigners();
      await expect(
        upgrades.deployProxy(Client, [owner.address, 0, []], { kind: "uups" })
      ).to.be.reverted;
    });

    it("computes quorumSize as floor(2N/3)+1", async function () {
      const cases = [
        { n: 1, q: 1 },
        { n: 2, q: 2 },
        { n: 4, q: 3 },
        { n: 7, q: 5 },
        { n: 10, q: 7 },
        { n: 14, q: 10 }, // matches the live STRATO sample (14 validators, 10 sigs)
        { n: 21, q: 15 },
      ];
      for (const { n, q } of cases) {
        const { client } = await deploy(0, makeValidators(n));
        expect(await client.quorumSize()).to.equal(BigInt(q));
      }
    });
  });

  describe("submitHeader: happy path", function () {
    it("accepts a header signed by a full quorum and stores the receipts root", async function () {
      const validators = makeValidators(7);
      const { client, sortedValidators } = await deploy(100, validators);

      const receiptsRoot = "0x" + "ab".repeat(32);
      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
        receiptsRoot,
      });

      const sigs = quorumSigners(sortedValidators, validators, header);
      await expect(client.submitHeader(header, sigs))
        .to.emit(client, "HeaderSubmitted");

      expect(await client.tip()).to.equal(101n);
      expect(await client.getReceiptsRoot(101)).to.equal(receiptsRoot);
      expect(await client.hasReceiptsRoot(101)).to.be.true;
      expect(await client.hasReceiptsRoot(100)).to.be.false;
    });

    it("accepts a header with extra signatures beyond quorum", async function () {
      const validators = makeValidators(7);
      const { client, sortedValidators } = await deploy(100, validators);

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
      });

      // All 7 validators sign (more than the 5-of-7 quorum).
      const sigs = validators.map((v) => signCommit(v, header));
      await expect(client.submitHeader(header, sigs)).to.emit(
        client,
        "HeaderSubmitted"
      );
    });

    it("accepts a chain of headers advancing tip each time", async function () {
      const validators = makeValidators(4);
      const { client, sortedValidators } = await deploy(0, validators);

      for (let n = 1; n <= 5; n++) {
        const header = encodeHeader({
          number: n,
          currentValidators: sortedValidators,
          receiptsRoot: "0x" + n.toString(16).padStart(64, "0"),
        });
        const sigs = quorumSigners(sortedValidators, validators, header);
        await client.submitHeader(header, sigs);
      }
      expect(await client.tip()).to.equal(5n);
    });
  });

  describe("submitHeader: validator-set rotation", function () {
    it("applies a validator addition and updates the commitment", async function () {
      const validators = makeValidators(5);
      const { client, sortedValidators } = await deploy(100, validators);
      const oldCommitment = await client.validatorSetCommitment();

      // Generate a new validator with an address that doesn't collide with
      // the existing set.
      let newValidator;
      do {
        newValidator = ethers.Wallet.createRandom();
      } while (sortedValidators.includes(newValidator.address.toLowerCase()));

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
        newValidators: [newValidator.address.toLowerCase()],
      });
      const sigs = quorumSigners(sortedValidators, validators, header);

      await expect(client.submitHeader(header, sigs))
        .to.emit(client, "ValidatorSetRotated");

      expect(await client.isValidator(newValidator.address)).to.be.true;
      expect(await client.validatorCount()).to.equal(6n);
      expect(await client.validatorSetCommitment()).to.not.equal(oldCommitment);
    });

    it("applies a validator removal and lets the new set sign next block", async function () {
      const validators = makeValidators(5);
      const { client, sortedValidators } = await deploy(100, validators);

      const removed = sortedValidators[0];
      const remaining = validators.filter(
        (w) => w.address.toLowerCase() !== removed
      );

      // Block 101 carries the removal, signed by the OLD set (i.e. quorum
      // of all 5 including the one being removed).
      const header101 = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
        removedValidators: [removed],
      });
      await client.submitHeader(
        header101,
        quorumSigners(sortedValidators, validators, header101)
      );

      expect(await client.isValidator(removed)).to.be.false;
      expect(await client.validatorCount()).to.equal(4n);

      // Block 102: currentValidators must reflect the new set. Signing with
      // only the remaining 4 validators (quorum is now 3 of 4).
      const newSorted = sortedValidators.filter((a) => a !== removed);
      const header102 = encodeHeader({
        number: 102,
        currentValidators: newSorted,
      });
      await expect(
        client.submitHeader(
          header102,
          quorumSigners(newSorted, remaining, header102)
        )
      ).to.emit(client, "HeaderSubmitted");
    });

    it("rejects a post-rotation header that lies about currentValidators", async function () {
      const validators = makeValidators(5);
      const { client, sortedValidators } = await deploy(100, validators);

      // Apply a removal at block 101.
      const removed = sortedValidators[0];
      const header101 = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
        removedValidators: [removed],
      });
      await client.submitHeader(
        header101,
        quorumSigners(sortedValidators, validators, header101)
      );

      // Block 102 lies: claims currentValidators is still the old set.
      // The skip-safety check should reject this.
      const header102 = encodeHeader({
        number: 102,
        currentValidators: sortedValidators, // wrong: removed is gone
      });
      await expect(
        client.submitHeader(
          header102,
          quorumSigners(sortedValidators, validators, header102)
        )
      ).to.be.reverted;
    });
  });

  describe("submitHeader: adversarial", function () {
    it("rejects a header that is not in order (number <= tip)", async function () {
      const validators = makeValidators(4);
      const { client, sortedValidators } = await deploy(100, validators);

      const header = encodeHeader({
        number: 100, // not strictly greater than tip
        currentValidators: sortedValidators,
      });
      await expect(
        client.submitHeader(header, quorumSigners(sortedValidators, validators, header))
      ).to.be.reverted;
    });

    it("rejects insufficient signatures (below quorum)", async function () {
      const validators = makeValidators(7); // quorum is 5
      const { client, sortedValidators } = await deploy(100, validators);

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
      });
      // Only 4 sign (one short).
      const sortedSigners = [...validators].sort((a, b) =>
        BigInt(a.address) < BigInt(b.address) ? -1 : 1
      );
      const sigs = sortedSigners.slice(0, 4).map((w) => signCommit(w, header));

      await expect(client.submitHeader(header, sigs)).to.be.reverted;
    });

    it("rejects non-ascending signature order (catches duplicates)", async function () {
      const validators = makeValidators(5); // quorum is 4
      const { client, sortedValidators } = await deploy(100, validators);

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
      });
      const sortedSigners = [...validators].sort((a, b) =>
        BigInt(a.address) < BigInt(b.address) ? -1 : 1
      );
      // Submit sigs in DESCENDING order: violates strict-ascending invariant.
      const sigs = sortedSigners
        .slice(0, 4)
        .reverse()
        .map((w) => signCommit(w, header));

      await expect(client.submitHeader(header, sigs)).to.be.reverted;
    });

    it("rejects a signature from a non-validator", async function () {
      const validators = makeValidators(5); // quorum is 4
      const { client, sortedValidators } = await deploy(100, validators);

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
      });

      // Three real + one outsider, sorted ascending.
      const outsider = ethers.Wallet.createRandom();
      const mixed = [...validators.slice(0, 3), outsider].sort((a, b) =>
        BigInt(a.address) < BigInt(b.address) ? -1 : 1
      );
      const sigs = mixed.map((w) => signCommit(w, header));

      // Recovers four distinct ascending signers but only 3 are validators
      // -> distinctValid (3) < quorum (4) -> revert.
      await expect(client.submitHeader(header, sigs)).to.be.reverted;
    });

    it("rejects a header with mismatching currentValidators (skip-safety)", async function () {
      const validators = makeValidators(5);
      const { client } = await deploy(100, validators);

      // Forge a header that omits one of the genesis validators.
      const liar = makeValidators(5);
      const liarSorted = sortAddresses(liar.map((w) => w.address));

      const header = encodeHeader({
        number: 101,
        currentValidators: liarSorted,
      });
      const sigs = quorumSigners(liarSorted, liar, header);

      await expect(client.submitHeader(header, sigs)).to.be.reverted;
    });

    it("rejects a header with version != 2", async function () {
      const validators = makeValidators(4);
      const { client, sortedValidators } = await deploy(100, validators);

      // Hand-craft a header with version 1 (legacy V1 layout has different
      // field count anyway, but the version field check fires first).
      const badHeader = ethers.encodeRlp([
        "0x01", // version 1
        "0x" + "00".repeat(32),
        "0x" + "00".repeat(32),
        "0x" + "00".repeat(32),
        "0x" + "00".repeat(32),
        "0x" + "00".repeat(32),
        "0x65", // number = 101
        "0x",
        "0x" + "00".repeat(32),
        sortedValidators,
        [],
        [],
        "0x",
        [],
      ]);
      const sigs = quorumSigners(sortedValidators, validators, badHeader);

      await expect(client.submitHeader(badHeader, sigs)).to.be.reverted;
    });
  });

  describe("getReceiptsRoot", function () {
    it("reverts for a block we haven't accepted", async function () {
      const validators = makeValidators(4);
      const { client } = await deploy(100, validators);
      await expect(client.getReceiptsRoot(50)).to.be.reverted;
      await expect(client.getReceiptsRoot(101)).to.be.reverted;
    });

    it("returns the empty-trie root for a block submitted with one", async function () {
      const validators = makeValidators(4);
      const { client, sortedValidators } = await deploy(100, validators);

      // Empty receipts trie root = keccak256(rlp(""))
      // = 0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421
      const emptyTrieRoot =
        "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";

      const header = encodeHeader({
        number: 101,
        currentValidators: sortedValidators,
        receiptsRoot: emptyTrieRoot,
      });
      await client.submitHeader(header, quorumSigners(sortedValidators, validators, header));

      expect(await client.getReceiptsRoot(101)).to.equal(emptyTrieRoot);
      expect(await client.hasReceiptsRoot(101)).to.be.true;
    });
  });
});

/* eslint-disable no-unused-vars */
ZERO32; // intentionally referenced for future tests

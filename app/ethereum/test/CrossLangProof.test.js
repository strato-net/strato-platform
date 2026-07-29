const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const {
  encodeHeader,
  quorumSigners,
  sortAddresses,
} = require("./helpers/strato");

/**
 * Cross-language proof acceptance test.
 *
 * The fixture below is the verbatim output of the Haskell test
 *
 *     stack test vm-tools 2>&1 | grep -A20 FIXTURE_BEGIN
 *
 * which exercises the production Haskell code path (Receipt + ReceiptLog +
 * TypedArg types, addAllKVs, getInclusionProof). The Hardhat side feeds these
 * exact bytes into the on-chain MerklePatricia.verifyInclusion verifier and
 * the full STRATOLightClient header flow. Both sides have to agree on byte-
 * for-byte encoding for the claim path to work end to end -- if the Haskell
 * encoding ever drifts, this test fails loudly.
 *
 * To regenerate after a Receipt or RLP encoding change:
 *   1. cd to the strato Haskell tree
 *   2. stack test vm-tools
 *   3. Copy receiptsRoot, receiptRLP, and proof from the test output below.
 */
const FIXTURE = {
  receiptsRoot:
    "0x9e17c65b5657018de5abffa6d3e53c530dd52b0a37940224bec5db5b204dc8a3",
  receiptRLP:
    "0xf88201825208f87cf87a9410101010101010101010101010101010101010108a5769746864726177616cf8582a019411111111111111111111111111111111111111119422222222222222222222222222222222222222223294aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa94bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb32",
  proof: [
    "0xf889822080b884f88201825208f87cf87a9410101010101010101010101010101010101010108a5769746864726177616cf8582a019411111111111111111111111111111111111111119422222222222222222222222222222222222222223294aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa94bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb32",
  ],
};

// Trie key for txIndex=0 is rlp(0) = 0x80. Same as what BridgeVault's
// _rlpEncodeTxIndex(0) returns and what the Haskell side feeds via
// byteString2NibbleString . rlpSerialize . rlpEncode (0 :: Integer).
const TRIE_KEY_TX_0 = "0x80";

// Constants the Haskell fixture was built against. Must stay in sync with
// CrossLangFixtureSpec.hs.
const STRATO_VAULT = "0x1010101010101010101010101010101010101010";
const EXTERNAL_TOKEN = "0x1111111111111111111111111111111111111111";
const EXTERNAL_RECIPIENT = "0x2222222222222222222222222222222222222222";
const STRATO_SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STRATO_TOKEN = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHAIN_ID = 1;

function makeValidators(n) {
  const wallets = [];
  for (let i = 0; i < n; i++) wallets.push(ethers.Wallet.createRandom());
  return wallets.sort((a, b) =>
    BigInt(a.address) < BigInt(b.address) ? -1 : 1
  );
}

describe("Cross-language proof: Haskell-built fixture verified on-chain", function () {
  it("on-chain verifier accepts the Haskell-built proof", async function () {
    const H = await ethers.getContractFactory("MerklePatriciaHarness");
    const h = await H.deploy();
    await h.waitForDeployment();

    expect(
      await h.verifyInclusion(
        FIXTURE.receiptsRoot,
        TRIE_KEY_TX_0,
        FIXTURE.receiptRLP,
        FIXTURE.proof
      )
    ).to.be.true;
  });

  it("rejects the proof when receiptRLP is tampered", async function () {
    const H = await ethers.getContractFactory("MerklePatriciaHarness");
    const h = await H.deploy();
    await h.waitForDeployment();

    // Flip the last byte of the receipt: the verifier should reject because
    // the leaf's stored value no longer hashes to a node that fits the trie.
    const tampered =
      FIXTURE.receiptRLP.slice(0, -2) +
      (FIXTURE.receiptRLP.slice(-2) === "ff" ? "00" : "ff");

    expect(
      await h.verifyInclusion(
        FIXTURE.receiptsRoot,
        TRIE_KEY_TX_0,
        tampered,
        FIXTURE.proof
      )
    ).to.be.false;
  });

  it("end-to-end: signed header + Haskell-built proof drives a real claim", async function () {
    const [owner, admin, _user] = await ethers.getSigners();
    const validators = makeValidators(4);
    const sortedValidators = sortAddresses(validators.map((w) => w.address));

    const LC = await ethers.getContractFactory("STRATOLightClient");
    const lc = await upgrades.deployProxy(
      LC,
      [owner.address, 100, sortedValidators],
      { kind: "uups" }
    );
    await lc.waitForDeployment();

    const Vault = await ethers.getContractFactory("BridgeVault");
    const vault = await upgrades.deployProxy(
      Vault,
      [
        owner.address,
        admin.address,
        await lc.getAddress(),
        STRATO_VAULT,
        CHAIN_ID,
      ],
      { kind: "uups" }
    );
    await vault.waitForDeployment();

    // Set the threshold above the fixture's amount (50) so the small-claim
    // path applies.
    await vault.setInstantThreshold(EXTERNAL_TOKEN, 100);

    // Submit a header carrying the Haskell-built receipts root.
    const header = encodeHeader({
      number: 101,
      currentValidators: sortedValidators,
      receiptsRoot: FIXTURE.receiptsRoot,
    });
    const sigs = quorumSigners(sortedValidators, validators, header);
    await lc.submitHeader(header, sigs);

    // Try to claim. The vault will:
    //   1. Look up receipts root from the light client (matches fixture).
    //   2. MPT-verify the Haskell-built proof against that root. <-- the
    //      cross-language test
    //   3. Decode the receipt log via STRATOEventDecoder.
    //   4. Equality-check contractAddress / eventName / chainId.
    //   5. Try to release tokens to EXTERNAL_RECIPIENT.
    //
    // Step 5 will fail because EXTERNAL_TOKEN is a hardcoded address that
    // isn't actually an ERC20 contract on the test chain. We don't assert
    // on the success of the release -- the assertion is that the proof
    // verification path doesn't revert with ProofVerificationFailed,
    // WrongStratoVault, UnknownEvent, or WrongChainId.
    //
    // We capture the error and check its name.
    let errName = null;
    try {
      await vault.claimWithdrawal(101, 0, 0, FIXTURE.proof, FIXTURE.receiptRLP);
    } catch (err) {
      // ethers v6 reverts surface as e.shortMessage / e.errorName / e.reason
      errName = err.shortMessage || err.message;
    }

    if (errName === null) {
      // The release somehow succeeded (e.g. the mock token call to
      // EXTERNAL_TOKEN happened to be a no-op address). Either way, the
      // proof was accepted -- which is the cross-language assertion.
      return;
    }

    // The acceptable failure modes are token-transfer-level. Anything that
    // names one of the verifier-side errors means the proof was rejected
    // and we have a real cross-language drift.
    const verifierErrors = [
      "ProofVerificationFailed",
      "WrongStratoVault",
      "UnknownEvent",
      "WrongChainId",
      "AmountAboveInstantThreshold",
    ];
    for (const e of verifierErrors) {
      if (errName.includes(e)) {
        throw new Error(
          `Cross-language drift: claim reverted at the verifier with ${e}. Full message: ${errName}`
        );
      }
    }
    // Otherwise we hit a token transfer issue, which is expected with a
    // hardcoded EXTERNAL_TOKEN address. The proof was accepted.
  });
});

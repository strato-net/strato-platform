/**
 * Helpers for synthesizing STRATO data structures in tests:
 *   - building RLP-encoded V2 block headers with empty `signatures`
 *   - producing the canonical block hash and commit-message digest
 *   - signing the digest with test wallets and packing R||S||V (V in {0,1})
 *
 * The STRATO conventions (Phase 0 spec §2-§4):
 *   - headerRLP = rlp([2, parentHash, stateRoot, txRoot, receiptsRoot,
 *                      logsBloom, number, timestamp, extraData,
 *                      currentValidators, newValidators, removedValidators,
 *                      proposalSignature, []])
 *   - blockHash = keccak256(headerRLP)
 *   - commitMsg = keccak256(blockHash || 0x02)
 *   - V on STRATO is 0 or 1 (ethers gives 27/28; we subtract 27)
 */

const { ethers } = require("hardhat");

const HEADER_VERSION = 2;
const COMMIT_DOMAIN = "0x02";

/**
 * Build the RLP-encoded V2 header. Defaults exist for fields the tests
 * usually don't care about; supply only what matters for the case under test.
 *
 * @param {object} fields
 * @param {number|bigint} fields.number
 * @param {string} fields.parentHash 32-byte hex
 * @param {string} fields.stateRoot 32-byte hex
 * @param {string} fields.transactionsRoot 32-byte hex
 * @param {string} fields.receiptsRoot 32-byte hex
 * @param {string[]} fields.currentValidators 20-byte hex addresses
 * @param {string[]} fields.newValidators
 * @param {string[]} fields.removedValidators
 * @param {string|null} fields.proposalSignature 65-byte hex or null
 * @param {number|bigint} fields.timestamp
 * @returns {string} 0x-prefixed hex of the RLP-encoded header
 */
function encodeHeader(fields) {
  const f = {
    parentHash: "0x" + "00".repeat(32),
    stateRoot: "0x" + "00".repeat(32),
    transactionsRoot: "0x" + "00".repeat(32),
    receiptsRoot: "0x" + "00".repeat(32),
    logsBloom: "0x" + "00".repeat(32),
    timestamp: 0,
    extraData: "0x" + "00".repeat(32),
    newValidators: [],
    removedValidators: [],
    proposalSignature: null,
    ...fields,
  };

  // RLP-encode `Maybe Signature` per `RLP.hs:308-318`:
  //   Nothing    -> empty string ("")
  //   Just sig   -> single-element list wrapping the 65-byte signature
  const proposalSig = f.proposalSignature
    ? [f.proposalSignature]
    : "0x";

  return ethers.encodeRlp([
    toRlpUint(HEADER_VERSION),
    f.parentHash,
    f.stateRoot,
    f.transactionsRoot,
    f.receiptsRoot,
    f.logsBloom,
    toRlpUint(f.number),
    toRlpUint(f.timestamp),
    f.extraData,
    f.currentValidators,
    f.newValidators,
    f.removedValidators,
    proposalSig,
    [], // signatures field always empty for canonical hash
  ]);
}

function toRlpUint(value) {
  const big = BigInt(value);
  if (big === 0n) return "0x";
  // Strip leading zeros from the hex representation.
  let hex = big.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  return "0x" + hex;
}

/**
 * Compute the commit-message digest that validators sign.
 */
function commitDigest(headerRLP) {
  const blockHash = ethers.keccak256(headerRLP);
  return ethers.keccak256(ethers.concat([blockHash, COMMIT_DOMAIN]));
}

/**
 * Sign the commit digest with a wallet's signing key, producing the 65-byte
 * R || S || V (V in {0,1}) blob the light client expects.
 */
function signCommit(wallet, headerRLP) {
  const digest = commitDigest(headerRLP);
  const sig = wallet.signingKey.sign(digest);
  // ethers returns yParity as 0/1 in v6, but `v` is 27/28. We want 0/1.
  const v = sig.v === 27 ? 0 : 1;
  return ethers.concat([sig.r, sig.s, "0x" + v.toString(16).padStart(2, "0")]);
}

/**
 * Sort an address list ascending and lowercase it. Light-client inits and
 * header `currentValidators` are required to be strictly ascending.
 */
function sortAddresses(addrs) {
  return [...addrs]
    .map((a) => a.toLowerCase())
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
}

/**
 * Pick a quorum of signers from a sorted validator list. STRATO requires
 * floor(2N/3) + 1 distinct signatures, in strictly-ascending recovered-address
 * order (the light client enforces ascending order to deduplicate cheaply).
 */
function quorumSigners(validators, signers, headerRLP) {
  const quorum = Math.floor((2 * validators.length) / 3) + 1;
  const sortedSigners = [...signers]
    .sort((a, b) => (BigInt(a.address.toLowerCase()) < BigInt(b.address.toLowerCase()) ? -1 : 1))
    .slice(0, quorum);
  return sortedSigners.map((w) => signCommit(w, headerRLP));
}

module.exports = {
  HEADER_VERSION,
  COMMIT_DOMAIN,
  encodeHeader,
  commitDigest,
  signCommit,
  sortAddresses,
  quorumSigners,
  toRlpUint,
};

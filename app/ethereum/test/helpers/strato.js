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
    version: HEADER_VERSION,
    ...fields,
  };

  // RLP-encode `Maybe Signature` per `RLP.hs:308-318`:
  //   Nothing    -> empty string ("")
  //   Just sig   -> single-element list wrapping the 65-byte signature
  const proposalSig = f.proposalSignature
    ? [f.proposalSignature]
    : "0x";

  const version = f.version ?? HEADER_VERSION;
  const body = [
    toRlpUint(version),
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
  ];

  // V3 appends three stake fields after the V2 tail. The decoder reads none of
  // them -- they exist here so the field COUNT matches what a live V3 node
  // emits, which is what the length check keys off.
  if (version === 3) {
    body.push([], [], []);
  }

  return ethers.encodeRlp(body);
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

// ============ Receipts + single-tx trie ============

/**
 * Encode a STRATO receipt that contains exactly one Withdrawal- or
 * WithdrawalRequested-shaped log (Phase 0 §6.2 / §6.3 / §7.1).
 *
 * The base 8-arg payload is encoded positionally with typed RLP rules:
 *   - addresses encode as 20-byte strings
 *   - integers encode as minimal big-endian (RLP integer convention)
 *
 * Hot-path Withdrawal events also append `prevWithdrawalBlock` and `seq`
 * (10-arg layout) so the BridgeVault's sequence-ordered queue can drive
 * release ordering. Pass `seq` (and optionally `prevWithdrawalBlock`) to
 * opt into the new layout; omit both for the cold-path 8-arg encoding.
 */
function encodeWithdrawalReceipt(opts) {
  const args = [
    toRlpUint(opts.nonce),
    toRlpUint(opts.externalChainId),
    opts.externalToken,
    opts.externalRecipient,
    toRlpUint(opts.externalTokenAmount),
    opts.stratoSender,
    opts.stratoToken,
    toRlpUint(opts.stratoTokenAmount),
  ];
  if (opts.seq !== undefined) {
    args.push(toRlpUint(opts.prevWithdrawalBlock ?? 0));
    args.push(toRlpUint(opts.seq));
  }
  const log = [
    opts.contractAddress,
    ethers.hexlify(ethers.toUtf8Bytes(opts.eventName)),
    args,
  ];
  const receipt = [
    toRlpUint(opts.status ?? 1),
    toRlpUint(opts.gasUsed ?? 21000),
    [log], // logs is a list; we only need one log per receipt for these tests
  ];
  return ethers.encodeRlp(receipt);
}

/**
 * Build a trie containing exactly one (txIndex=0, value) entry. Returns the
 * root, the trie-key bytes the verifier expects, and the inclusion proof
 * (which for a single-leaf trie is just `[leafRLP]`).
 *
 *   txIndex = 0  ->  rlp(0) = 0x80  ->  key bytes = 0x80
 *   nibbles of 0x80                 = [0x8, 0x0]   (even-length, leaf)
 *   HP-encoded leaf path             = 0x20 0x80
 *   leaf node                        = rlp([0x2080, value])
 *   root                             = keccak256(leaf node bytes)
 */
function singleTxReceiptsTrie(value) {
  const hpPath = "0x2080";
  const leafRLP = ethers.encodeRlp([hpPath, value]);
  const root = ethers.keccak256(leafRLP);
  return {
    root,
    trieKey: "0x80",
    proof: [leafRLP],
  };
}

/**
 * Build a trie for a block with txIndex=0 AND txIndex=1, returning the root
 * and per-index inclusion proofs. Exercises the branch-node path of the MPT
 * verifier (vs the single-leaf-only case in `singleTxReceiptsTrie`).
 *
 *   key 0 = rlp(0) = 0x80, nibbles = [8, 0]
 *   key 1 = rlp(1) = 0x01, nibbles = [0, 1]
 *
 * The two key paths share no common prefix, so the trie is a branch with
 * two non-empty slots:
 *
 *   branch[0]  -> odd-leaf with remaining path [1] -> value1   (HP = 0x31)
 *   branch[8]  -> odd-leaf with remaining path [0] -> value0   (HP = 0x30)
 *
 * Both leaves serialize to >=32 bytes for our Withdrawal receipts, so the
 * branch references them by hash. Proof for index k:
 *   [branchRLP, leafRLP_k]
 */
function twoTxReceiptsTrie(value0, value1) {
  const leaf0RLP = ethers.encodeRlp(["0x30", value0]); // remaining path [0]
  const leaf1RLP = ethers.encodeRlp(["0x31", value1]); // remaining path [1]

  if (ethers.dataLength(leaf0RLP) < 32 || ethers.dataLength(leaf1RLP) < 32) {
    throw new Error(
      "twoTxReceiptsTrie expects both leaves to hash (>=32 bytes); use a Withdrawal-shaped value"
    );
  }

  const hash0 = ethers.keccak256(leaf0RLP);
  const hash1 = ethers.keccak256(leaf1RLP);

  const empty = "0x"; // RLP empty-string slot
  const branchSlots = [
    hash1, // slot 0  -> child for txIndex=1
    empty, empty, empty, empty, empty, empty, empty,
    hash0, // slot 8  -> child for txIndex=0
    empty, empty, empty, empty, empty, empty, empty,
    empty, // slot 16 -> no value at the root
  ];
  const branchRLP = ethers.encodeRlp(branchSlots);
  const root = ethers.keccak256(branchRLP);

  return {
    root,
    proofs: {
      0: { trieKey: "0x80", proof: [branchRLP, leaf0RLP] },
      1: { trieKey: "0x01", proof: [branchRLP, leaf1RLP] },
    },
  };
}

/**
 * Build a synthetic (key, value, root, proof) tuple for a trie whose leaf is
 * inlined into a parent branch. Specifically: a branch where the leaf for
 * one slot is short enough (<32 bytes serialized) to be embedded directly
 * in the parent rather than referenced by hash.
 *
 *   keyA = 0x4f, nibbles [4, 15] -> leaf at branch[4] with path [15]
 *   keyB = 0x80, nibbles [8, 0]  -> leaf at branch[8] with path [0]
 *
 * Tiny values keep the leaves below the 32-byte hash threshold.
 */
function inlinedChildTrie(valueShort) {
  // valueShort is something tiny like "0x42"
  const hpA = "0x3f"; // odd-leaf, last nibble = f
  const hpB = "0x30"; // odd-leaf, last nibble = 0
  const leafARLP = ethers.encodeRlp([hpA, valueShort]);
  const leafBRLP = ethers.encodeRlp([hpB, valueShort]);

  if (ethers.dataLength(leafARLP) >= 32 || ethers.dataLength(leafBRLP) >= 32) {
    throw new Error("inlinedChildTrie requires tiny leaves; pick smaller values");
  }

  // Branch slots embed the leaves' RLP directly (parser sees a list, not a
  // 32-byte hash). MerklePatricia._classifyChild flips into the Inlined
  // branch and walks without consuming a proof entry.
  const empty = "0x";
  const branchSlots = [
    empty, empty, empty, empty,
    leafARLP, // slot 4: inlined leaf for keyA
    empty, empty, empty,
    leafBRLP, // slot 8: inlined leaf for keyB
    empty, empty, empty, empty, empty, empty, empty,
    empty, // slot 16
  ];

  // The slots above are raw RLP byte sequences. encodeRlp of an array of
  // hex strings would re-wrap them as RLP byte strings, which isn't what we
  // want. Build the branch list by direct concatenation: outer list header
  // + each slot's bytes verbatim.
  const branchRLP = encodeRlpListOfRawNodes(branchSlots);
  const root = ethers.keccak256(branchRLP);

  return {
    root,
    proofs: {
      a: { trieKey: "0x4f", proof: [branchRLP] }, // no proof entry for inlined leaf
      b: { trieKey: "0x80", proof: [branchRLP] },
    },
    valueShort,
  };
}

/**
 * RLP-encode a list whose elements are ALREADY RLP-encoded. ethers'
 * `encodeRlp` would treat each hex string as a raw byte string and re-wrap
 * it; we want the elements written verbatim.
 */
function encodeRlpListOfRawNodes(elements) {
  // Concat element bytes (skipping their "0x" prefix), measure payload, emit
  // the RLP list header, append payload.
  let payloadBytes = new Uint8Array(0);
  for (const e of elements) {
    if (e === "0x") {
      // Empty entry encodes as RLP empty-string: 0x80.
      payloadBytes = concatBytes(payloadBytes, new Uint8Array([0x80]));
    } else {
      payloadBytes = concatBytes(payloadBytes, ethers.getBytes(e));
    }
  }
  const len = payloadBytes.length;
  let header;
  if (len <= 55) {
    header = new Uint8Array([0xc0 + len]);
  } else {
    // Long list: 0xf7 + lenOfLen, then big-endian length.
    const lenBytes = bigEndian(len);
    header = concatBytes(new Uint8Array([0xf7 + lenBytes.length]), lenBytes);
  }
  return ethers.hexlify(concatBytes(header, payloadBytes));
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bigEndian(n) {
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = n >>> 8;
  }
  return new Uint8Array(bytes);
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
  encodeWithdrawalReceipt,
  singleTxReceiptsTrie,
  twoTxReceiptsTrie,
  inlinedChildTrie,
};

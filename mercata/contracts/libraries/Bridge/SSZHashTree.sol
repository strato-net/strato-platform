/**
 * @notice ExecutionPayloadHeader fields for Deneb / Electra / Fulu.
 *
 *         Defined at file scope so it can be used as a parameter or
 *         storage type from contracts that import this library.
 *
 *         logsBloomRoot and extraDataRoot are caller-provided
 *         pre-computed roots — logs_bloom is 256 bytes (8 chunks
 *         merkleized to depth 3) and extra_data is a ByteList
 *         requiring length mixin. Both are too large to feed in raw
 *         and would dominate calldata; the executionBranch verification
 *         catches any cheating because it ties the EPH root we compute
 *         here back to the verified beacon body root.
 */
struct ExecutionPayloadHeader {
    bytes32 parentHash;
    address feeRecipient;
    bytes32 stateRoot;
    bytes32 receiptsRoot;
    bytes32 logsBloomRoot;     // pre-hashed off-chain
    bytes32 prevRandao;
    uint64  blockNumber;
    uint64  gasLimit;
    uint64  gasUsed;
    uint64  timestamp;
    bytes32 extraDataRoot;     // pre-hashed off-chain
    uint256 baseFeePerGas;
    bytes32 blockHash;
    bytes32 transactionsRoot;
    bytes32 withdrawalsRoot;
    uint64  blobGasUsed;
    uint64  excessBlobGas;
}

/**
 * @title SSZHashTree
 * @notice SimpleSerialize hash_tree_root + Merkle proof primitives for
 *         the Ethereum→STRATO bridge. Pure SHA-256 work; no curve
 *         arithmetic, no precompiles beyond the SHA-256 builtin.
 *
 *         What's here:
 *           1. SSZ leaf encoders for the primitive types we hash:
 *              uint64 (LE-padded) and bytes4 (left-justified).
 *           2. Merkleize helpers for fixed-arity containers (2 fields,
 *              5 fields). Padding to next-power-of-2 with zero-leaves
 *              follows the SSZ spec.
 *           3. hash_tree_root for the BeaconBlockHeader and ForkData
 *              containers — the only ones the light client needs.
 *           4. compute_domain / compute_signing_root, the final two
 *              steps that turn a verified attested header into the
 *              signing root that the sync committee BLS-signed.
 *           5. verify_merkle_branch — used to verify the
 *              finalityBranch (proves finalized_header from
 *              attestedHeader.stateRoot) and the executionBranch
 *              (proves the execution payload header from the beacon
 *              block body root).
 *
 * @dev    SHA-256 in SolidVM accepts dynamic bytes and returns a
 *         32-byte digest typed as bytes32. Bytes-to-bytes32 and
 *         bytes32-to-bytes casts are zero-cost views.
 */
library SSZHashTree {

    // ─────────────────────────────────────────────────────────────────
    // SSZ leaf encoders
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice SSZ-serialize a uint64 to a 32-byte leaf.
     *
     *         SSZ uses **little-endian** for integers, then
     *         right-pads with zero bytes to the chunk size (32). So
     *         the leaf bytes are:
     *           [v_byte0, v_byte1, ..., v_byte7, 0x00, ..., 0x00]
     *         where v_byte0 = v & 0xff (the LSB of v).
     *
     *         Returned as bytes32 with byte 0 = LSB of v, byte 1 =
     *         next byte, etc. (i.e. byte 0 of bytes32 is the high
     *         byte of the underlying 256-bit word).
     */
    function uint64ToLeaf(uint64 v) internal pure returns (bytes32) {
        // Place each LE byte of v into the high end of a 256-bit word.
        // Byte i (0-indexed from the LSB of v) goes to bytes32 byte i,
        // which is bit position (31 - i) * 8 of the underlying uint256.
        uint256 result = 0;
        uint256 vv = uint256(v);
        for (uint256 i = 0; i < 8; i = i + 1) {
            result = result | ((vv & 0xff) << ((31 - i) * 8));
            vv = vv >> 8;
        }
        return bytes32(result);
    }

    /**
     * @notice SSZ-serialize a 4-byte fork version to a 32-byte leaf.
     *         Just left-justifies the 4 bytes; right-pads with zeros.
     */
    function bytes4ToLeaf(bytes4 v) internal pure returns (bytes32) {
        // SolidVM's bytes32(bytesN) cast doesn't zero-pad to 32 bytes,
        // so we go via uint and an explicit shift instead. uint256(v)
        // reads v as a big-endian integer in the low 32 bits; shifting
        // left by 224 places those 4 bytes at the top of the resulting
        // bytes32 (= byte 0..3), with the lower 28 bytes zero.
        return bytes32(uint256(v) << 224);
    }

    // ─────────────────────────────────────────────────────────────────
    // Container Merkleization
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice hash_tree_root of a 2-field SSZ container — already a
     *         power of 2, no padding needed.
     */
    function merkleize2(bytes32 l0, bytes32 l1) internal pure returns (bytes32) {
        return bytes32(sha256(bytes(l0) + bytes(l1)));
    }

    /**
     * @notice hash_tree_root of a 5-field SSZ container.
     *
     *         Padded to 8 leaves (next power of 2 ≥ 5). Padding
     *         leaves are zero. Tree depth = 3.
     *
     *         Layout:
     *           level 0 (8): [l0, l1, l2, l3, l4, 0, 0, 0]
     *           level 1 (4): [h(l0,l1), h(l2,l3), h(l4,0), h(0,0)]
     *           level 2 (2): [h(level1[0..2]), h(level1[2..4])]
     *           level 3 (1): root
     */
    function merkleize5(
        bytes32 l0, bytes32 l1, bytes32 l2, bytes32 l3, bytes32 l4
    ) internal pure returns (bytes32) {
        bytes32 z = bytes32(0);
        // Level 1: pair up adjacent leaves.
        bytes32 n0 = bytes32(sha256(bytes(l0) + bytes(l1)));
        bytes32 n1 = bytes32(sha256(bytes(l2) + bytes(l3)));
        bytes32 n2 = bytes32(sha256(bytes(l4) + bytes(z)));
        bytes32 n3 = bytes32(sha256(bytes(z) + bytes(z)));
        // Level 2.
        bytes32 m0 = bytes32(sha256(bytes(n0) + bytes(n1)));
        bytes32 m1 = bytes32(sha256(bytes(n2) + bytes(n3)));
        // Level 3 (root).
        return bytes32(sha256(bytes(m0) + bytes(m1)));
    }

    // ─────────────────────────────────────────────────────────────────
    // Beacon-chain containers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice hash_tree_root(BeaconBlockHeader).
     *
     *         BeaconBlockHeader is a 5-field SSZ container:
     *           slot           : uint64
     *           proposer_index : uint64
     *           parent_root    : bytes32
     *           state_root     : bytes32
     *           body_root      : bytes32
     *
     *         The first two fields are uint64 → SSZ-encoded as 8 LE
     *         bytes + 24 zeros; the last three are already 32-byte
     *         leaves.
     */
    function hashTreeRootBeaconHeader(
        uint64 slot,
        uint64 proposerIndex,
        bytes32 parentRoot,
        bytes32 stateRoot,
        bytes32 bodyRoot
    ) internal pure returns (bytes32) {
        return merkleize5(
            uint64ToLeaf(slot),
            uint64ToLeaf(proposerIndex),
            parentRoot,
            stateRoot,
            bodyRoot
        );
    }

    /**
     * @notice hash_tree_root(ForkData).
     *
     *         ForkData is a 2-field SSZ container:
     *           current_version          : bytes4 → leaf is left-justified, zero-padded
     *           genesis_validators_root  : bytes32
     */
    function hashTreeRootForkData(
        bytes4 forkVersion,
        bytes32 genesisValidatorsRoot
    ) internal pure returns (bytes32) {
        return merkleize2(bytes4ToLeaf(forkVersion), genesisValidatorsRoot);
    }

    // ─────────────────────────────────────────────────────────────────
    // Domain + signing root
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice compute_domain per the consensus-specs.
     *
     *         domain = domain_type (4 bytes) || fork_data_root[:28]
     *
     *         Returns a 32-byte value where bytes [0..3] are the
     *         domain type and bytes [4..31] are the first 28 bytes of
     *         hash_tree_root(ForkData).
     */
    function computeDomain(
        bytes4 domainType,
        bytes4 forkVersion,
        bytes32 genesisValidatorsRoot
    ) internal pure returns (bytes32) {
        bytes32 forkDataRoot = hashTreeRootForkData(forkVersion, genesisValidatorsRoot);
        // Build the 32-byte domain: top 4 bytes = domainType, remaining
        // 28 bytes = first 28 bytes of forkDataRoot. We do this with
        // pure bit-ops rather than dynamic-bytes concatenation so the
        // result is a stack-resident bytes32 with no allocation.
        //
        //   typeBits  = domainType bytes left-justified in the top 4
        //               bytes of the word (uint256(v) reads v as BE
        //               into the low 32 bits, so we shift left by 224
        //               to push those 4 bytes to bits 224..255 →
        //               bytes32 positions 0..3).
        //   rootBits  = forkDataRoot >> 32 — drops the bottom 4 bytes
        //               and shifts the top 28 bytes down into the
        //               bottom 28 byte positions; top 4 bytes become 0.
        //   domain    = typeBits | rootBits
        uint256 typeBits = uint256(domainType) << 224;
        uint256 rootBits = uint256(forkDataRoot) >> 32;
        return bytes32(typeBits | rootBits);
    }

    /**
     * @notice compute_signing_root per the consensus-specs.
     *
     *         signing_root = sha256(object_root || domain)
     *
     *         For sync-committee verification, object_root =
     *         hash_tree_root(attested_header) and domain comes from
     *         compute_domain(DOMAIN_SYNC_COMMITTEE, fork_version,
     *         genesis_validators_root).
     */
    function computeSigningRoot(bytes32 objectRoot, bytes32 domain)
        internal
        pure
        returns (bytes32)
    {
        return bytes32(sha256(bytes(objectRoot) + bytes(domain)));
    }

    // ─────────────────────────────────────────────────────────────────
    // ExecutionPayloadHeader hash_tree_root (Fulu / Electra / Deneb)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice SSZ-encode a uint256 as a 32-byte little-endian leaf.
     *         Used for base_fee_per_gas (uint256) inside the EPH.
     */
    function uint256ToLELeaf(uint256 v) internal pure returns (bytes32) {
        // Reverse byte order: place LSB at byte 0 of bytes32, MSB at byte 31.
        uint256 result = 0;
        uint256 vv = v;
        for (uint256 i = 0; i < 32; i = i + 1) {
            result = result | ((vv & 0xff) << ((31 - i) * 8));
            vv = vv >> 8;
        }
        return bytes32(result);
    }

    /**
     * @notice SSZ-encode a 20-byte address as a 32-byte leaf, left-justified.
     *         Used for fee_recipient inside the EPH.
     */
    function addressToLeaf(address a) internal pure returns (bytes32) {
        // address as uint160 occupies the bottom 160 bits; shift up by 96
        // so the 20 bytes land at byte positions 0..19 of the bytes32.
        return bytes32(uint256(uint160(a)) << 96);
    }

    /**
     * @notice hash_tree_root(ExecutionPayloadHeader) for Deneb / Electra / Fulu.
     *
     *         17 fields padded to 32 leaves (depth 5). 31 internal
     *         sha256 calls plus the 6 non-trivial leaf encodings.
     */
    function hashTreeRootEPH(ExecutionPayloadHeader eph) internal pure returns (bytes32) {
        bytes32 z = bytes32(0);

        // Build the 32 leaves (17 fields + 15 zero pad).
        bytes32[] leaves = new bytes32[](32);
        leaves[0]  = eph.parentHash;
        leaves[1]  = addressToLeaf(eph.feeRecipient);
        leaves[2]  = eph.stateRoot;
        leaves[3]  = eph.receiptsRoot;
        leaves[4]  = eph.logsBloomRoot;
        leaves[5]  = eph.prevRandao;
        leaves[6]  = uint64ToLeaf(eph.blockNumber);
        leaves[7]  = uint64ToLeaf(eph.gasLimit);
        leaves[8]  = uint64ToLeaf(eph.gasUsed);
        leaves[9]  = uint64ToLeaf(eph.timestamp);
        leaves[10] = eph.extraDataRoot;
        leaves[11] = uint256ToLELeaf(eph.baseFeePerGas);
        leaves[12] = eph.blockHash;
        leaves[13] = eph.transactionsRoot;
        leaves[14] = eph.withdrawalsRoot;
        leaves[15] = uint64ToLeaf(eph.blobGasUsed);
        leaves[16] = uint64ToLeaf(eph.excessBlobGas);
        for (uint256 i = 17; i < 32; i = i + 1) {
            leaves[i] = z;
        }

        // Merkleize 32 leaves to depth 5. We collapse pairs in-place
        // by overwriting the lower half of the working array each round.
        // After level 1 has 16 nodes, level 2 has 8, ..., level 5 has 1 = root.
        uint256 n = 32;
        while (n > 1) {
            uint256 half = n / 2;
            for (uint256 i = 0; i < half; i = i + 1) {
                leaves[i] = bytes32(sha256(bytes(leaves[2 * i]) + bytes(leaves[2 * i + 1])));
            }
            n = half;
        }
        return leaves[0];
    }

    // ─────────────────────────────────────────────────────────────────
    // Merkle proof verification
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a Merkle inclusion proof.
     *
     *         Walks from leaf upward, hashing with the matching
     *         sibling at each level. The bits of @param index decide
     *         left vs right at each level: bit i set ⇒ leaf was the
     *         right child at level i; bit i clear ⇒ left child.
     *
     *         Used for both the finality branch (5 levels deep,
     *         proving finalized_header from attested_header.state_root)
     *         and the execution branch (4 levels, proving the
     *         execution payload header from beacon body root).
     *
     * @param  leaf    the value claimed to live in the tree
     * @param  branch  sibling hashes from leaf level upward
     * @param  index   leaf's 0-based position in its level
     * @param  root    expected Merkle root at the top
     */
    function verifyMerkleBranch(
        bytes32 leaf,
        bytes32[] branch,
        uint256 index,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 value = leaf;
        for (uint256 i = 0; i < branch.length; i = i + 1) {
            if (((index >> i) & 1) == 1) {
                value = bytes32(sha256(bytes(branch[i]) + bytes(value)));
            } else {
                value = bytes32(sha256(bytes(value) + bytes(branch[i])));
            }
        }
        return value == root;
    }
}

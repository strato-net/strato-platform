import "./RLPDecode.sol";

/**
 * @title  MPTProof
 * @notice Ethereum-style Merkle-Patricia Trie inclusion-proof verifier,
 *         SolidVM-native (no inline assembly).
 *
 *         Built for receipts-trie verification: keys are rlp(txIndex),
 *         values are typically `txType_byte || rlp(receipt)` (post-2718)
 *         or just `rlp(receipt)` (legacy), and the trie root is the
 *         `receipts_root` field of the execution payload header.
 *
 *         Algorithm follows the Yellow Paper. Three node types:
 *           * Branch    : 17-element list. Slots 0..15 keyed by nibble;
 *                         slot 16 is the value if path terminates here.
 *           * Extension : 2-element list [hpPath, child].
 *           * Leaf      : 2-element list [hpPath, value]. Terminal.
 *
 *         Children may be referenced by 32-byte hash (next proof entry
 *         is the resolved node bytes) or RLP-inlined when the node's
 *         RLP serialization is shorter than 32 bytes (descend into the
 *         inlined bytes; no proof entry consumed).
 *
 *         Hex-prefix (HP) encoding of paths:
 *           First nibble of byte 0:
 *             0x0 = extension, even-length path
 *             0x1 = extension, odd-length path (low nibble of byte 0
 *                                              is the first path nibble)
 *             0x2 = leaf,      even-length path
 *             0x3 = leaf,      odd-length path
 */
library MPTProof {
    using RLPDecode for *;

    /**
     * @notice Verify that (key, expectedValue) is committed to the trie
     *         at @root, given a proof = sequence of node RLP encodings
     *         from root to leaf.
     *
     * @param root          Expected trie root (keccak256 of root node's RLP).
     * @param key           Raw key bytes (will be nibblized internally).
     * @param expectedValue Raw value bytes that should appear at the leaf.
     * @param proof         Sequence of RLP-encoded trie nodes, one per
     *                      hashed reference along the root-to-leaf path.
     */
    function verifyInclusion(
        bytes32 root,
        bytes key,
        bytes expectedValue,
        bytes[] proof
    ) internal pure returns (bool) {
        if (proof.length == 0) return false;

        uint8[] keyNibbles = _toNibbles(key);
        uint256 keyIdx = 0;

        bytes32 expectedHash = root;
        bytes currentNode = proof[0];
        uint256 proofIdx = 0;
        bool currentIsHashed = true; // root is referenced by hash

        // Worst-case loop bound: any well-formed receipts-trie proof has
        // at most ~32 hashed steps for keys up to 64 nibbles (= 32-byte
        // keccak'd keys). Receipts-trie keys are rlp(uint) ≤ 9 bytes
        // → 18 nibbles, so ≤ 18 levels of branches/extensions/leaves.
        // We cap iterations to keep the proof bounded.
        uint256 stepsLeft = 64;
        while (stepsLeft != 0) {
            stepsLeft = stepsLeft - 1;

            if (currentIsHashed && keccak256(currentNode) != expectedHash) {
                return false;
            }

            bytes[] nodeList = RLPDecode.decodeList(currentNode);

            if (nodeList.length == 17) {
                // ─── Branch ───
                if (keyIdx == keyNibbles.length) {
                    // Path consumed: value lives in slot 16.
                    return _bytesEq(RLPDecode.decodeBytes(nodeList[16]), expectedValue);
                }
                uint256 nibble = uint256(keyNibbles[keyIdx]);
                keyIdx = keyIdx + 1;

                // Resolve the child reference.
                bytes childItem = nodeList[nibble];
                if (_isEmptyChild(childItem)) return false;
                if (RLPDecode.isList(childItem)) {
                    // Inlined sub-node: descend without consuming proof.
                    currentNode = childItem;
                    currentIsHashed = false;
                } else {
                    // Hashed child: next proof entry should be the node.
                    bytes32 childHash = RLPDecode.decodeBytes32(childItem);
                    proofIdx = proofIdx + 1;
                    if (proofIdx >= proof.length) return false;
                    currentNode = proof[proofIdx];
                    expectedHash = childHash;
                    currentIsHashed = true;
                }
            } else if (nodeList.length == 2) {
                // ─── Leaf or Extension ───
                bytes hpBytes = RLPDecode.decodeBytes(nodeList[0]);
                (uint8[] pathNibbles, bool isLeaf) = _decodeHP(hpBytes);

                // Path must be a prefix of the remaining key.
                if (keyIdx + pathNibbles.length > keyNibbles.length) return false;
                for (uint256 j = 0; j < pathNibbles.length; j = j + 1) {
                    if (keyNibbles[keyIdx + j] != pathNibbles[j]) return false;
                }
                keyIdx = keyIdx + pathNibbles.length;

                if (isLeaf) {
                    if (keyIdx != keyNibbles.length) return false;
                    return _bytesEq(RLPDecode.decodeBytes(nodeList[1]), expectedValue);
                } else {
                    bytes childItem2 = nodeList[1];
                    if (_isEmptyChild(childItem2)) return false;
                    if (RLPDecode.isList(childItem2)) {
                        currentNode = childItem2;
                        currentIsHashed = false;
                    } else {
                        bytes32 childHash2 = RLPDecode.decodeBytes32(childItem2);
                        proofIdx = proofIdx + 1;
                        if (proofIdx >= proof.length) return false;
                        currentNode = proof[proofIdx];
                        expectedHash = childHash2;
                        currentIsHashed = true;
                    }
                }
            } else {
                // Malformed: a trie node is always 17- or 2-element.
                return false;
            }
        }
        return false; // proof too deep
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev True if `item` is the empty-string RLP encoding (0x80) — i.e.
     *      a child slot pointing at nothing. We use that rather than
     *      decoding the bytes (which would allocate).
     */
    function _isEmptyChild(bytes item) private pure returns (bool) {
        return item.length == 1 && uint8(item[0]) == 0x80;
    }

    /// @dev Expand a byte string into its nibble (4-bit) sequence.
    ///      [0xab, 0xcd] → [0x0a, 0x0b, 0x0c, 0x0d].
    ///      Returns a uint8[] (one element per nibble) rather than a
    ///      `bytes` because SolidVM doesn't surface a clean
    ///      uint8→bytes1 cast — assigning into a bytes-array element
    ///      from a uint8 trips the typechecker.
    function _toNibbles(bytes data) private pure returns (uint8[] nibbles) {
        nibbles = new uint8[](data.length * 2);
        for (uint256 i = 0; i < data.length; i = i + 1) {
            uint8 b = uint8(data[i]);
            nibbles[2 * i]     = uint8(b >> 4);
            nibbles[2 * i + 1] = uint8(b & 0x0f);
        }
    }

    /**
     * @dev Decode a hex-prefixed (HP) trie path. Returns the path
     *      nibbles plus a flag for leaf (true) vs. extension (false).
     */
    function _decodeHP(bytes hp) private pure returns (uint8[] nibbles, bool isLeaf) {
        require(hp.length > 0, "MPTProof: empty HP path");
        uint8 first = uint8(hp[0]);
        uint8 flag = uint8(first >> 4);
        require(flag <= 3, "MPTProof: invalid HP flag");

        isLeaf = flag >= 2;
        bool oddLen = (flag & 1) == 1;

        // If odd, byte 0 contributes one nibble (the low nibble); the
        // rest of bytes 1..N contribute two nibbles each. If even, byte
        // 0 is purely the flag and contributes zero nibbles.
        uint256 nibbleCount = oddLen
            ? (hp.length * 2 - 1)
            : ((hp.length - 1) * 2);
        nibbles = new uint8[](nibbleCount);

        uint256 ni = 0;
        if (oddLen) {
            nibbles[0] = uint8(first & 0x0f);
            ni = 1;
        }
        for (uint256 i = 1; i < hp.length; i = i + 1) {
            uint8 b = uint8(hp[i]);
            nibbles[ni]     = uint8(b >> 4);
            nibbles[ni + 1] = uint8(b & 0x0f);
            ni = ni + 2;
        }
    }

    /// @dev Bytes equality via keccak. Cheaper than a length-then-loop
    ///      for typical receipt sizes.
    function _bytesEq(bytes a, bytes b) private pure returns (bool) {
        if (a.length != b.length) return false;
        return keccak256(a) == keccak256(b);
    }
}

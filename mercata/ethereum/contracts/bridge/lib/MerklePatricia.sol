// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {RLPReader} from "./RLPReader.sol";

/**
 * @title MerklePatricia
 * @notice Inclusion-proof verifier for Ethereum-style Merkle Patricia Tries.
 *
 *         Specifically targeted at the STRATO receipts trie (Phase 0 §6.1):
 *         keys are @rlp(txIndex)@, values are @rlp(Receipt)@, and the trie
 *         root is committed to in the V2 block header.
 *
 *         The algorithm follows the Yellow Paper. There are three node types,
 *         each RLP-encoded:
 *
 *           * Branch  -- 17-element list. Slots 0-15 are keyed by nibble;
 *             slot 16 is the value if the path terminates here.
 *           * Extension -- 2-element list [hpPath, child]. Shared prefix
 *             nibbles plus a single child reference.
 *           * Leaf    -- 2-element list [hpPath, value]. Terminal.
 *
 *         Children may be either:
 *           * A 32-byte hash, in which case the next node bytes appear as
 *             the next entry in `proof`.
 *           * An RLP-inlined sub-node when the child's serialization is
 *             shorter than 32 bytes. No corresponding `proof` entry; the
 *             walker just descends into the inlined bytes.
 *
 *         Hex-prefix (HP) encoding of paths:
 *           * First nibble of the first byte:
 *               0x0X = extension, even-length path
 *               0x1X = extension, odd-length path (X is the first nibble)
 *               0x2X = leaf,      even-length path
 *               0x3X = leaf,      odd-length path
 */
library MerklePatricia {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    error MalformedNode();
    error MalformedProof();

    /**
     * @notice Verify that the given (key, value) pair is committed to in the
     *         trie rooted at `root`, using `proof` as the sequence of trie
     *         nodes from root to leaf.
     *
     * @param root Expected trie root (32-byte keccak hash of the root node's
     *             RLP serialization, or the special empty-trie root).
     * @param key Raw key bytes. The verifier nibblizes internally.
     * @param expectedValue Raw value bytes. Must match the leaf payload byte-
     *                      for-byte.
     * @param proof Sequence of trie nodes, each one the full RLP serialization
     *              of a node along the root-to-leaf path. Inlined children
     *              add no entries.
     */
    function verifyInclusion(
        bytes32 root,
        bytes memory key,
        bytes memory expectedValue,
        bytes[] memory proof
    ) internal pure returns (bool) {
        if (proof.length == 0) return false;

        bytes memory keyNibbles = _toNibbles(key);
        uint256 keyIdx;

        bytes32 expectedHash = root;
        bytes memory currentNode = proof[0];
        uint256 proofIdx;
        bool currentIsHashed = true; // root is always referenced by hash

        while (true) {
            // For hashed references, verify the node bytes match the expected
            // hash. For inlined references, the bytes are part of the parent's
            // RLP and we trust them by construction.
            if (currentIsHashed && keccak256(currentNode) != expectedHash) {
                return false;
            }

            RLPReader.RLPItem memory node = currentNode.toRLPItem();
            if (!node.isList()) revert MalformedNode();
            RLPReader.RLPItem[] memory nodeList = node.toList();

            if (nodeList.length == 17) {
                // -------- Branch --------
                if (keyIdx == keyNibbles.length) {
                    // Path consumed: value lives in slot 16.
                    return _bytesEq(nodeList[16].toBytes(), expectedValue);
                }
                uint8 nibble = uint8(keyNibbles[keyIdx]);
                keyIdx++;

                ChildRef memory child = _classifyChild(nodeList[nibble]);
                if (child.kind == ChildKind.Empty) return false;
                (currentNode, expectedHash, currentIsHashed, proofIdx) = _stepInto(child, proof, proofIdx);
            } else if (nodeList.length == 2) {
                // -------- Leaf or extension --------
                (bytes memory pathNibbles, bool isLeaf) = _decodeHP(nodeList[0].toBytes());

                // Path must be a prefix of the remaining key.
                if (keyIdx + pathNibbles.length > keyNibbles.length) return false;
                for (uint256 j; j < pathNibbles.length; ++j) {
                    if (keyNibbles[keyIdx + j] != pathNibbles[j]) return false;
                }
                keyIdx += pathNibbles.length;

                if (isLeaf) {
                    if (keyIdx != keyNibbles.length) return false;
                    return _bytesEq(nodeList[1].toBytes(), expectedValue);
                } else {
                    // Extension: descend into the child.
                    ChildRef memory child = _classifyChild(nodeList[1]);
                    if (child.kind == ChildKind.Empty) return false;
                    (currentNode, expectedHash, currentIsHashed, proofIdx) = _stepInto(child, proof, proofIdx);
                }
            } else {
                revert MalformedNode();
            }
        }
        // unreachable; the loop returns from inside
    }

    // ============ Child resolution ============

    enum ChildKind {
        Empty, // child slot is the empty string
        Hashed, // child is a 32-byte hash; next proof entry is the node
        Inlined // child is the RLP of a sub-node; descend without consuming proof
    }

    struct ChildRef {
        ChildKind kind;
        bytes32 hash; // for Hashed
        bytes inlined; // for Inlined (the full sub-node RLP bytes)
    }

    function _classifyChild(RLPReader.RLPItem memory item)
        private
        pure
        returns (ChildRef memory ref)
    {
        if (item.isList()) {
            // Inlined sub-node, embedded as a list.
            ref.kind = ChildKind.Inlined;
            ref.inlined = _itemBytes(item);
            return ref;
        }
        uint256 plen = item.payloadLength();
        if (plen == 0) {
            ref.kind = ChildKind.Empty;
            return ref;
        }
        if (plen == 32) {
            ref.kind = ChildKind.Hashed;
            ref.hash = item.toBytes32();
            return ref;
        }
        // String of unusual length in a child slot is malformed for our trie.
        revert MalformedNode();
    }

    function _stepInto(
        ChildRef memory child,
        bytes[] memory proof,
        uint256 proofIdx
    )
        private
        pure
        returns (
            bytes memory nextNode,
            bytes32 nextExpectedHash,
            bool nextIsHashed,
            uint256 nextProofIdx
        )
    {
        if (child.kind == ChildKind.Hashed) {
            uint256 next = proofIdx + 1;
            if (next >= proof.length) revert MalformedProof();
            return (proof[next], child.hash, true, next);
        } else {
            return (child.inlined, bytes32(0), false, proofIdx);
        }
    }

    /// @dev Re-extract the full RLP encoding (header + payload) of an item.
    ///      Needed for inlined children, which we treat as if they were a
    ///      fresh `bytes memory` wrapping the same node.
    function _itemBytes(RLPReader.RLPItem memory item)
        private
        pure
        returns (bytes memory out)
    {
        out = new bytes(item.len);
        uint256 src = item.memPtr;
        uint256 dst;
        assembly {
            dst := add(out, 0x20)
        }
        for (uint256 i; i < item.len; i += 32) {
            assembly {
                mstore(add(dst, i), mload(add(src, i)))
            }
        }
    }

    // ============ Path / nibble helpers ============

    /// @dev Convert a byte string into its nibble (4-bit) representation.
    ///      `[0xab, 0xcd]` -> `[0xa, 0xb, 0xc, 0xd]`.
    function _toNibbles(bytes memory data) private pure returns (bytes memory out) {
        out = new bytes(data.length * 2);
        for (uint256 i; i < data.length; ++i) {
            out[2 * i] = bytes1(uint8(data[i]) >> 4);
            out[2 * i + 1] = bytes1(uint8(data[i]) & 0x0f);
        }
    }

    /// @dev Decode hex-prefixed path encoding. Returns the path nibbles plus
    ///      a flag for leaf-vs-extension.
    function _decodeHP(bytes memory hp)
        private
        pure
        returns (bytes memory nibbles, bool isLeaf)
    {
        if (hp.length == 0) revert MalformedNode();
        uint8 first = uint8(hp[0]);
        uint8 flag = first >> 4;
        if (flag > 3) revert MalformedNode();

        isLeaf = flag >= 2;
        bool oddLen = (flag & 1) == 1;

        // Allocate the nibble buffer. Even-length paths use only the low
        // nibble of the first byte for the flag; odd-length paths pack one
        // path nibble into the low half of the first byte.
        uint256 byteCount = hp.length;
        uint256 nibbleCount = oddLen ? (byteCount * 2 - 1) : ((byteCount - 1) * 2);
        nibbles = new bytes(nibbleCount);

        uint256 ni;
        if (oddLen) {
            nibbles[0] = bytes1(first & 0x0f);
            ni = 1;
        }
        for (uint256 i = 1; i < byteCount; ++i) {
            uint8 b = uint8(hp[i]);
            nibbles[ni++] = bytes1(b >> 4);
            nibbles[ni++] = bytes1(b & 0x0f);
        }
    }

    function _bytesEq(bytes memory a, bytes memory b) private pure returns (bool) {
        if (a.length != b.length) return false;
        return keccak256(a) == keccak256(b);
    }
}

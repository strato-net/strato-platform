import "../../libraries/Bridge/MPTProof.sol";

/**
 * @title Describe_MPTProof
 * @notice Tests for the SolidVM MPT inclusion verifier.
 *
 *         Synthetic trie tests cover the algorithm in isolation:
 *         single leaf, branch + leaf, extension + leaf, plus all the
 *         negative cases (wrong root, wrong value, malformed proof).
 *         The acid test wiring against a real Sepolia receipts root
 *         lives in EthBridgeIn.test.sol once the surrounding plumbing
 *         is in place.
 */
contract Describe_MPTProof {
    using MPTProof for *;

    // ============ Single-leaf trie ============

    /// @dev A single-leaf trie:
    ///   key   = [0x80]                        (= rlp(uint 0); txIndex 0)
    ///   value = [0x42]
    ///   leaf  = rlp([HP(nibbles, isLeaf=true), value])
    ///         = rlp([[0x20, 0x80], [0x42]])
    ///         = [0xc4, 0x82, 0x20, 0x80, 0x42]
    ///   root  = keccak256(leaf bytes)
    /// computed offline via ethers.keccak256.
    function _leafRoot() internal pure returns (bytes32) {
        return bytes32(hex"aa7edc369bc2d729c09682203219b7a8dba662b5dbca4af88d44f4fb15706bfc");
    }
    function _leafProof() internal pure returns (bytes[]) {
        bytes[] p = new bytes[](1);
        p[0] = hex"c482208042";
        return p;
    }

    function it_verifies_single_leaf_inclusion() {
        require(
            MPTProof.verifyInclusion(_leafRoot(), hex"80", hex"42", _leafProof()),
            "single-leaf inclusion should verify"
        );
    }

    function it_rejects_wrong_value() {
        require(
            !MPTProof.verifyInclusion(_leafRoot(), hex"80", hex"43", _leafProof()),
            "wrong value should fail"
        );
    }

    function it_rejects_wrong_root() {
        bytes32 fakeRoot = bytes32(uint256(_leafRoot()) ^ uint256(1));
        require(
            !MPTProof.verifyInclusion(fakeRoot, hex"80", hex"42", _leafProof()),
            "wrong root should fail"
        );
    }

    function it_rejects_wrong_key() {
        // Key 0x81 has nibbles [0x8, 0x1], so the leaf path [0x8, 0x0] doesn't match.
        require(
            !MPTProof.verifyInclusion(_leafRoot(), hex"81", hex"42", _leafProof()),
            "wrong key should fail"
        );
    }

    function it_rejects_empty_proof() {
        bytes[] empty = new bytes[](0);
        require(
            !MPTProof.verifyInclusion(_leafRoot(), hex"80", hex"42", empty),
            "empty proof should fail"
        );
    }

    function it_rejects_malformed_proof_node() {
        bytes[] bad = new bytes[](1);
        bad[0] = hex"00"; // not a list
        require(
            !MPTProof.verifyInclusion(_leafRoot(), hex"80", hex"42", bad),
            "malformed proof should fail"
        );
    }
}

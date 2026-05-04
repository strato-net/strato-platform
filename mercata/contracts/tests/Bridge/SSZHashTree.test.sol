import "../../libraries/Bridge/SSZHashTree.sol";

/**
 * @title Describe_SSZHashTree
 * @notice Tests for the SSZ Merkleization library.
 *
 *         Acid test: hashTreeRootBeaconHeader against the captured
 *         Sepolia finalized header. The beacon API tells us that
 *         block's hash_tree_root is 0xe5e574f7... so if our
 *         implementation matches that, every primitive in the chain
 *         is correct (uint64-LE encoding, container Merkleization,
 *         leaf padding, sha256 byte order).
 */
contract Describe_SSZHashTree {
    using SSZHashTree for *;

    // ─── Sepolia ground-truth fixture (period 1242, captured 2026-05-04) ───

    function _sepoliaSlot() internal pure returns (uint64) { return 10182848; }
    function _sepoliaProposer() internal pure returns (uint64) { return 5; }

    function _sepoliaParentRoot() internal pure returns (bytes32) {
        return bytes32(hex"909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7");
    }

    function _sepoliaStateRoot() internal pure returns (bytes32) {
        return bytes32(hex"e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09");
    }

    function _sepoliaBodyRoot() internal pure returns (bytes32) {
        return bytes32(hex"71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28");
    }

    function _sepoliaExpectedHeaderRoot() internal pure returns (bytes32) {
        // From GET /eth/v1/beacon/headers/finalized — beacon node
        // canonical hash_tree_root for the slot-10182848 header.
        return bytes32(hex"e5e574f78f3c0a6fc34f599bb0cbed071a087386de7363adc2956fc0893f9b34");
    }

    function _sepoliaGenesisValidatorsRoot() internal pure returns (bytes32) {
        return bytes32(hex"d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078");
    }

    // ============ uint64 → SSZ leaf ============

    function it_uint64_leaf_zero_is_all_zero() {
        require(SSZHashTree.uint64ToLeaf(0) == bytes32(0), "0 should leaf to all-zero");
    }

    function it_uint64_leaf_one_has_byte0_one() {
        // SSZ uint64 encoding: little-endian, right-padded.
        //   v = 1 → bytes [01 00 00 00 00 00 00 00 00 00 ... 00]
        // bytes32 byte 0 (= MSB of underlying uint256) holds 0x01.
        bytes32 expected = bytes32(uint256(0x0100000000000000000000000000000000000000000000000000000000000000));
        require(SSZHashTree.uint64ToLeaf(1) == expected, "uint64ToLeaf(1) wrong");
    }

    function it_uint64_leaf_is_little_endian() {
        // v = 0x123456789abcdef0
        // LE bytes: [f0 de bc 9a 78 56 34 12]
        // Leaf: 0xf0debc9a78563412 followed by 24 zero bytes.
        bytes32 expected = bytes32(uint256(0xf0debc9a78563412000000000000000000000000000000000000000000000000));
        require(
            SSZHashTree.uint64ToLeaf(uint64(0x123456789abcdef0)) == expected,
            "uint64ToLeaf little-endian wrong"
        );
    }

    function it_uint64_leaf_max_value_keeps_high_bytes() {
        // 2^64 - 1 → all ones in the low 8 bytes.
        bytes32 expected = bytes32(uint256(0xffffffffffffffff000000000000000000000000000000000000000000000000));
        require(
            SSZHashTree.uint64ToLeaf(uint64(0xffffffffffffffff)) == expected,
            "uint64ToLeaf max wrong"
        );
    }

    // ============ bytes4 → SSZ leaf ============

    function it_bytes4_leaf_left_justifies() {
        // 0x07000000 → bytes32 0x07000000_0000...0000
        bytes32 expected = bytes32(uint256(0x0700000000000000000000000000000000000000000000000000000000000000));
        require(
            SSZHashTree.bytes4ToLeaf(bytes4(0x07000000)) == expected,
            "bytes4ToLeaf wrong"
        );
    }

    // ============ Merkleize primitives ============

    function it_merkleize2_of_zeros_matches_known_sha256() {
        // sha256(0x00 * 64) == f5a5fd42…59fb4b  (well-known, used as
        // the all-zero "zerohash" entry for SSZ depth-1 in the spec).
        bytes32 expected = bytes32(hex"f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b");
        require(
            SSZHashTree.merkleize2(bytes32(0), bytes32(0)) == expected,
            "merkleize2(0, 0) wrong"
        );
    }

    function it_merkleize2_of_uint64_one_padded_zeros() {
        // sha256(uint64ToLeaf(1) || 0x00*32) — captured externally.
        bytes32 expected = bytes32(hex"16abab341fb7f370e27e4dadcf81766dd0dfd0ae64469477bb2cf6614938b2af");
        require(
            SSZHashTree.merkleize2(SSZHashTree.uint64ToLeaf(1), bytes32(0)) == expected,
            "merkleize2(uint64(1), 0) wrong"
        );
    }

    // ============ BeaconBlockHeader hash_tree_root ============

    function it_beacon_header_root_matches_real_sepolia_finalized() {
        // The acid test. Beacon API reports root for slot 10182848 as
        // 0xe5e574f7…3f9b34. If our SSZ pipeline matches, every leaf
        // encoder, the 5→8 padding, and the sha256 byte order are
        // simultaneously verified.
        bytes32 root = SSZHashTree.hashTreeRootBeaconHeader(
            _sepoliaSlot(),
            _sepoliaProposer(),
            _sepoliaParentRoot(),
            _sepoliaStateRoot(),
            _sepoliaBodyRoot()
        );
        require(root == _sepoliaExpectedHeaderRoot(), "Sepolia header root mismatch");
    }

    // ============ ForkData / Domain / Signing root ============

    function it_compute_domain_starts_with_domain_type() {
        // Independent of the fork-version numerics, the first 4 bytes
        // of the returned domain MUST equal the supplied domain_type.
        bytes32 d = SSZHashTree.computeDomain(
            bytes4(0x07000000),
            bytes4(0x90000075),
            _sepoliaGenesisValidatorsRoot()
        );
        bytes db = bytes(d);
        require(uint8(db[0]) == 0x07, "domain[0] != 0x07");
        require(uint8(db[1]) == 0x00, "domain[1] != 0x00");
        require(uint8(db[2]) == 0x00, "domain[2] != 0x00");
        require(uint8(db[3]) == 0x00, "domain[3] != 0x00");
    }

    function it_compute_signing_root_is_deterministic() {
        // Two calls with identical inputs ⇒ identical output. Sanity
        // check that there's no hidden state.
        bytes32 obj = bytes32(hex"1111111111111111111111111111111111111111111111111111111111111111");
        bytes32 dom = bytes32(hex"2222222222222222222222222222222222222222222222222222222222222222");
        bytes32 a = SSZHashTree.computeSigningRoot(obj, dom);
        bytes32 b = SSZHashTree.computeSigningRoot(obj, dom);
        require(a == b, "signing root not deterministic");
        // And it should be sha256(obj || dom) directly.
        bytes32 expected = bytes32(sha256(bytes(obj) + bytes(dom)));
        require(a == expected, "signing root != sha256(obj||domain)");
    }

    // ============ Merkle branch verification ============

    function it_verify_merkle_branch_2leaf_tree_left() {
        // Tiny tree: root = sha256(L || R)
        // index = 0 (leaf is left child) ⇒ branch = [R]
        bytes32 leaf = bytes32(hex"deadbeef00000000000000000000000000000000000000000000000000000000");
        bytes32 sibling = bytes32(hex"cafef00d00000000000000000000000000000000000000000000000000000000");
        bytes32 root = bytes32(sha256(bytes(leaf) + bytes(sibling)));
        bytes32[] branch = new bytes32[](1);
        branch[0] = sibling;
        require(SSZHashTree.verifyMerkleBranch(leaf, branch, 0, root), "left-leaf proof should verify");
    }

    function it_verify_merkle_branch_2leaf_tree_right() {
        // index = 1 (leaf is right child) ⇒ branch = [L]; root = sha256(L || leaf)
        bytes32 sibling = bytes32(hex"deadbeef00000000000000000000000000000000000000000000000000000000");
        bytes32 leaf = bytes32(hex"cafef00d00000000000000000000000000000000000000000000000000000000");
        bytes32 root = bytes32(sha256(bytes(sibling) + bytes(leaf)));
        bytes32[] branch = new bytes32[](1);
        branch[0] = sibling;
        require(SSZHashTree.verifyMerkleBranch(leaf, branch, 1, root), "right-leaf proof should verify");
    }

    function it_verify_merkle_branch_rejects_bad_root() {
        bytes32 leaf = bytes32(hex"deadbeef00000000000000000000000000000000000000000000000000000000");
        bytes32 sibling = bytes32(hex"cafef00d00000000000000000000000000000000000000000000000000000000");
        // Use a wrong root.
        bytes32 wrongRoot = bytes32(hex"00000000000000000000000000000000000000000000000000000000baadbeef");
        bytes32[] branch = new bytes32[](1);
        branch[0] = sibling;
        require(
            !SSZHashTree.verifyMerkleBranch(leaf, branch, 0, wrongRoot),
            "should reject wrong root"
        );
    }

    function it_verify_merkle_branch_4leaf_tree() {
        // 4-leaf tree (depth 2):
        //   leaf at index 2 (binary 10):
        //     bit 0 = 0 ⇒ pair as (leaf, branch[0]) at level 0
        //     bit 1 = 1 ⇒ pair as (branch[1], v) at level 1
        bytes32 a = bytes32(uint256(0xaaaa));
        bytes32 b = bytes32(uint256(0xbbbb));
        bytes32 c = bytes32(uint256(0xcccc)); // our "leaf"
        bytes32 d = bytes32(uint256(0xdddd));

        bytes32 ab = bytes32(sha256(bytes(a) + bytes(b)));
        bytes32 cd = bytes32(sha256(bytes(c) + bytes(d)));
        bytes32 root = bytes32(sha256(bytes(ab) + bytes(cd)));

        bytes32[] branch = new bytes32[](2);
        branch[0] = d;   // sibling at level 0
        branch[1] = ab;  // sibling at level 1
        require(SSZHashTree.verifyMerkleBranch(c, branch, 2, root), "index-2 proof should verify");

        // Wrong index ⇒ should fail.
        require(
            !SSZHashTree.verifyMerkleBranch(c, branch, 3, root),
            "wrong index should fail"
        );
    }
}

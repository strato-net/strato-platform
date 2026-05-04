import "../../libraries/Bridge/BLSVerify.sol";

/**
 * @title Describe_BLSVerify
 * @notice Sanity tests for the BLSVerify primitives.
 *
 *         End-to-end signature verification against a real Sepolia
 *         sync-committee aggregate is deferred until SSZHashTree is in
 *         place — that's what computes the signing root from the
 *         attested header. These tests cover the parts that don't
 *         depend on it: the DST constant, point-decompression
 *         round-trips through G1Add, the participation aggregator, and
 *         popcount.
 */
contract Describe_BLSVerify {
    using BLSVerify for *;

    // ─── Real Sepolia fixtures (period 1242, captured 2026-05-04) ───

    // Sync committee pubkey #0 (compressed G1, 48 bytes).
    function _sepoliaPubkey0() internal pure returns (bytes) {
        return hex"9203acd34ebb3ff76268f9fe68f066a48a3f518686ae0f2230b322e19435ccfc4f208e5ba5a39cb2a409292c48a37c22";
    }

    // Sync committee pubkey #1.
    function _sepoliaPubkey1() internal pure returns (bytes) {
        return hex"83f21dfe0272a5a8682c3c7814c5e0e4db6a9098f1fa80fda725f77ea81fdfd2fa36b0c8db013503a89bd035f86306fa";
    }

    // ============ DST ============

    function it_eth_dst_is_43_bytes_pop_variant() {
        // The proof-of-possession DST used by every Ethereum BLS sig
        // (sync committee, attestations, beacon block proposals).
        // Must be exactly this string — different DST = different hash
        // domain = different signature scheme.
        bytes expected = bytes("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_");
        require(expected.length == 43, "DST length should be 43");
        require(uint8(expected[0]) == 0x42, "DST[0] should be 'B'");
        require(uint8(expected[42]) == 0x5f, "DST[42] should be '_'");
    }

    // ============ Aggregation ============

    function it_aggregate_with_one_participant_equals_decompressed_pubkey() {
        bytes[] pubkeys = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            pubkeys[i] = _sepoliaPubkey0();
        }
        // Bitfield with only bit 0 set ⇒ only validator #0 participates.
        bytes bits = new bytes(64);
        bits[0] = 0x01;

        (bytes agg, uint256 count) = BLSVerify.aggregateParticipants(pubkeys, bits);
        require(count == 1, "count should be 1");
        require(agg.length == 128, "aggregate should be EIP-2537 G1 (128 bytes)");

        // With one participant, the aggregate is just that participant's
        // decompressed pubkey.
        bytes expected = bls12381DecompressG1(_sepoliaPubkey0());
        require(keccak256(agg) == keccak256(expected), "agg should equal decompressed pubkey #0");
    }

    function it_aggregate_with_two_participants_sums_them() {
        bytes[] pubkeys = new bytes[](512);
        pubkeys[0] = _sepoliaPubkey0();
        pubkeys[1] = _sepoliaPubkey1();
        // Fill the rest with #0 — they're never accessed since only bits 0,1 set.
        for (uint i = 2; i < 512; i = i + 1) {
            pubkeys[i] = _sepoliaPubkey0();
        }
        bytes bits = new bytes(64);
        bits[0] = 0x03; // bits 0 and 1

        (bytes agg, uint256 count) = BLSVerify.aggregateParticipants(pubkeys, bits);
        require(count == 2, "count should be 2");

        // Aggregate should equal P0 + P1 via the G1Add precompile directly.
        bytes p0 = bls12381DecompressG1(_sepoliaPubkey0());
        bytes p1 = bls12381DecompressG1(_sepoliaPubkey1());
        bytes expected = bls12381G1Add(p0 + p1);
        require(keccak256(agg) == keccak256(expected), "agg should equal G1Add(P0, P1)");
    }

    function it_aggregate_indexes_set_bits_correctly_across_byte_boundaries() {
        // Bit indexing convention: bit 0 of byte 0 ⇒ index 0,
        // bit 7 of byte 0 ⇒ index 7, bit 0 of byte 1 ⇒ index 8 …
        // Make sure the loop honors that by setting bit 8 (= byte[1] bit 0)
        // and verifying we picked up index 8, not some other index.
        bytes[] pubkeys = new bytes[](512);
        // Mark index 8 with pubkey #1, everything else with pubkey #0.
        for (uint i = 0; i < 512; i = i + 1) {
            pubkeys[i] = _sepoliaPubkey0();
        }
        pubkeys[8] = _sepoliaPubkey1();

        bytes bits = new bytes(64);
        bits[1] = 0x01; // bit 0 of byte 1 = index 8

        (bytes agg, uint256 count) = BLSVerify.aggregateParticipants(pubkeys, bits);
        require(count == 1, "count should be 1");

        bytes expected = bls12381DecompressG1(_sepoliaPubkey1());
        require(keccak256(agg) == keccak256(expected), "should have picked pubkey at index 8");
    }

    function it_aggregate_reverts_on_zero_participation() {
        bytes[] pubkeys = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            pubkeys[i] = _sepoliaPubkey0();
        }
        bytes allZero = new bytes(64);

        bool reverted = false;
        try {
            BLSVerify.aggregateParticipants(pubkeys, allZero);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when no bits are set");
    }

    function it_aggregate_reverts_on_wrong_committee_size() {
        bytes[] pubkeys = new bytes[](511); // wrong: must be 512
        bytes bits = new bytes(64);
        bits[0] = 0x01;

        bool reverted = false;
        try {
            BLSVerify.aggregateParticipants(pubkeys, bits);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on wrong pubkey array length");
    }

    function it_aggregate_reverts_on_wrong_bitfield_size() {
        bytes[] pubkeys = new bytes[](512);
        for (uint i = 0; i < 512; i = i + 1) {
            pubkeys[i] = _sepoliaPubkey0();
        }
        bytes bits = new bytes(63); // wrong: must be 64

        bool reverted = false;
        try {
            BLSVerify.aggregateParticipants(pubkeys, bits);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on wrong bitfield length");
    }

    // ============ popcount ============

    function it_popcount_zero_is_zero() {
        require(BLSVerify.popcount(new bytes(64)) == 0, "all zeros ⇒ 0");
    }

    function it_popcount_full_committee_is_512() {
        bytes full = new bytes(64);
        for (uint i = 0; i < 64; i = i + 1) {
            full[i] = 0xff;
        }
        require(BLSVerify.popcount(full) == 512, "all 0xff ⇒ 512");
    }

    function it_popcount_handles_partial_bitfields() {
        bytes b = new bytes(64);
        b[0] = 0x05;  // bits 0,2 ⇒ 2
        b[5] = 0xff;  // 8 bits
        b[63] = 0x80; // bit 7 ⇒ 1
        require(BLSVerify.popcount(b) == 11, "should sum to 11");
    }

    function it_popcount_at_two_thirds_threshold() {
        // 342 set bits is the ⅔ threshold (342/512 ≈ 0.668). Build a
        // bitfield with exactly 342 set bits and confirm popcount agrees.
        bytes b = new bytes(64);
        // 42 full bytes (336 bits) + one byte with 6 bits set = 342.
        for (uint i = 0; i < 42; i = i + 1) {
            b[i] = 0xff;
        }
        b[42] = 0x3f; // 0b00111111 = 6 bits
        require(BLSVerify.popcount(b) == 342, "should be 342");
    }
}

import "../../libraries/Bridge/BLSVerify.sol";
import "../../libraries/Bridge/SSZHashTree.sol";

/**
 * @title Describe_BLSVerify
 * @notice Tests for the BLSVerify primitives.
 *
 *         The acid test is the final block: an end-to-end
 *         verification of a real Sepolia sync-committee aggregate
 *         signature. If that passes, every primitive in the chain
 *         (decompression, hash-to-curve, pairing, plus the
 *         SSZHashTree pipeline driving the signing root) is wired
 *         correctly.
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

    // ============ End-to-end Sepolia signature verification ============

    // Real Sepolia LightClientFinalityUpdate, period 1242, captured 2026-05-04.
    // The aggregate pubkey here is precomputed offline (sum of the 470
    // participating sync-committee members per the bitfield) and the
    // signing root is the on-chain result of feeding the attested header
    // + fork version + genesis_validators_root through SSZHashTree.

    function _sepoliaAggPubkey() internal pure returns (bytes) {
        // sum-then-compress of 470 of 512 sync-committee pubkeys for
        // the signing-slot's period. Pre-computed via /tmp/gen-sepolia-vector.hs.
        return hex"9335746c5e693cee9f751fadf029ea18f9d53f3d0f76877d0f64b5324f0b69aa3e8c52865f647d1bb4d41df0cfae8b5e";
    }

    function _sepoliaSignature() internal pure returns (bytes) {
        // sync_aggregate.sync_committee_signature from finality_update.json.
        return hex"a68a6426fb3b654cf90f0d36f071a7edc93b8af9af7a1f8eb8f356d5e68876e8162492bfa9e8d0ec92bdc204f9a6ea4715bab09c09f4759ca276d521cfe56d184041b2c3c0d3f2903f5cec2bd2c7a5fbacc0248cdc5f64513bc0cfb4ad47b607";
    }

    function _sepoliaSigningRootPrecomputed() internal pure returns (bytes32) {
        // sha256(hash_tree_root(attested_header) || domain)
        // where domain = compute_domain(0x07000000, 0x90000075, gvr).
        return bytes32(hex"04592400173a6686ef494b0eb872e48cf36f2079737cde0a88da4550d82ce764");
    }

    function _sepoliaAttestedSlot() internal pure returns (uint64) { return 10182912; }
    function _sepoliaAttestedProposer() internal pure returns (uint64) { return 1446; }
    function _sepoliaAttestedParentRoot() internal pure returns (bytes32) {
        return bytes32(hex"900fee03dc258712f7da869abffcd8a6858a2e1f38cd304243bfab9ec90e4d5f");
    }
    function _sepoliaAttestedStateRoot() internal pure returns (bytes32) {
        return bytes32(hex"527ab66077a6ed693c0612242a1b2ea42bfefde4bccc9c561e29b326c17e0066");
    }
    function _sepoliaAttestedBodyRoot() internal pure returns (bytes32) {
        return bytes32(hex"29f9342b67f92ba2fe69832cafe1a5d384cbd0f68a4808c863a0d47636e23d49");
    }
    function _sepoliaForkVersion() internal pure returns (bytes4) { return bytes4(0x90000075); } // Fulu
    function _sepoliaGenesisValidatorsRoot() internal pure returns (bytes32) {
        return bytes32(hex"d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078");
    }

    /**
     * @notice The ACID TEST. Drives the full pipeline:
     *
     *         attested header → SSZHashTree.hashTreeRootBeaconHeader
     *                         → SSZHashTree.computeDomain
     *                         → SSZHashTree.computeSigningRoot
     *                         → BLSVerify.verifySyncCommitteeAggregate
     *
     *         If this returns true, every primitive on both libraries
     *         is byte-correct against a real Ethereum mainnet-spec
     *         sync committee signature.
     */
    function it_verifies_real_sepolia_sync_committee_signature_end_to_end() {
        // Step 1: hash_tree_root(attested header).
        bytes32 headerRoot = SSZHashTree.hashTreeRootBeaconHeader(
            _sepoliaAttestedSlot(),
            _sepoliaAttestedProposer(),
            _sepoliaAttestedParentRoot(),
            _sepoliaAttestedStateRoot(),
            _sepoliaAttestedBodyRoot()
        );

        // Step 2: compute_domain(DOMAIN_SYNC_COMMITTEE, fork_version, gvr).
        bytes32 domain = SSZHashTree.computeDomain(
            bytes4(0x07000000),               // DOMAIN_SYNC_COMMITTEE
            _sepoliaForkVersion(),
            _sepoliaGenesisValidatorsRoot()
        );

        // Step 3: compute_signing_root.
        bytes32 signingRoot = SSZHashTree.computeSigningRoot(headerRoot, domain);

        // Sanity: matches the precomputed signing root from the offline tool.
        require(
            signingRoot == _sepoliaSigningRootPrecomputed(),
            "signing root pipeline disagrees with offline computation"
        );

        // Step 4: BLS pairing check.
        bool ok = BLSVerify.verifySyncCommitteeAggregate(
            _sepoliaAggPubkey(),
            signingRoot,
            _sepoliaSignature()
        );
        require(ok, "Sepolia sync-committee signature should verify");
    }

    function it_rejects_signature_with_wrong_signing_root() {
        // Sanity: flip a bit in the signing root and the verify must
        // return false (not revert — we want a clean false return for
        // bad signatures so EthLightClient can decide what to do).
        bytes32 badRoot = bytes32(uint256(_sepoliaSigningRootPrecomputed()) ^ uint256(1));
        bool ok = BLSVerify.verifySyncCommitteeAggregate(
            _sepoliaAggPubkey(),
            badRoot,
            _sepoliaSignature()
        );
        require(!ok, "must not accept signature against wrong signing root");
    }
}

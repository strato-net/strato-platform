/**
 * @title BLSVerify
 * @notice BLS12-381 signature verification primitives for the
 *         Ethereum→STRATO bridge. Wraps the SolidVM precompile family
 *         (bls12381DecompressG1/G2, bls12381HashToCurveG2,
 *         bls12381G1Add, bls12381Pairing) into the two operations the
 *         light client actually needs:
 *
 *           1. Verify a sync-committee aggregate signature given the
 *              already-aggregated pubkey, the signing root, and the
 *              compressed signature.
 *           2. Build the aggregate pubkey from the bootstrap-supplied
 *              committee plus the per-update participation bitfield.
 *
 *         All inputs are in the wire format the beacon-chain HTTP API
 *         returns (compressed: G1=48B, G2=96B; pubkeys+sig in IETF /
 *         ZCash encoding). Decompression to EIP-2537 uncompressed form
 *         happens inside the library so EthLightClient never has to
 *         touch raw curve points.
 *
 * @dev    Pairing equation: a sync committee signature σ is valid for
 *         aggregate pubkey P over message M iff
 *               e(G1, σ) == e(P, H(M))
 *         where H : msg → G2 is hash_to_curve(BLS12381G2_XMD:SHA-256_SSWU_RO_)
 *         with the Ethereum sig DST. The bls12381Pairing precompile is
 *         shaped as "product of pairings == 1", so we re-arrange to
 *               e(-G1, σ) · e(P, H(M)) == 1
 *         and submit both pairs in one call. -G1 is precomputed and
 *         hardcoded since G1 is a static curve constant.
 */
library BLSVerify {

    // ─────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Domain Separation Tag for Ethereum's BLS signature
     *         scheme (proof-of-possession variant). Ratified in the
     *         consensus-specs as BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_
     *         and used by every validator signature (sync committee,
     *         attestations, block proposals).
     */
    function _ethDst() internal pure returns (bytes) {
        return bytes("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_");
    }

    /**
     * @notice Negated G1 generator in EIP-2537 uncompressed form
     *         (128 bytes = x.64 || y.64, each Fp = 16 zero pad + 48 value).
     *
     *         Standard BLS12-381 G1 generator from the IETF / ZCash spec:
     *           x = 0x17f1d3a7…22c6bb
     *           y = 0x08b3f481…6c5e7e1
     *         Negation is component-wise: (-y) = p - y = 0x114d1d68…39c2ca.
     *         Hardcoded so the pairing call doesn't need a runtime
     *         field-prime subtraction every time.
     */
    function _negG1Gen() internal pure returns (bytes) {
        return hex"0000000000000000000000000000000017f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb00000000000000000000000000000000114d1d6855d545a8aa7d76c8cf2e21f267816aef1db507c96655b9d5caac42364e6f38ba0ecb751bad54dcd6b939c2ca";
    }

    // ─────────────────────────────────────────────────────────────────
    // Verification
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a sync-committee aggregate signature.
     *
     * @param aggPubkeyCompressed Aggregate pubkey of the signing
     *        subset, in 48-byte IETF compressed form. Caller is
     *        responsible for building this via
     *        {aggregateParticipants}, or for using the precomputed
     *        full-committee aggregate from the bootstrap when *every*
     *        validator participated.
     * @param signingRoot The 32-byte signing root; for the light client
     *        this is sha256(hash_tree_root(attested_header) || domain)
     *        with domain = compute_domain(DOMAIN_SYNC_COMMITTEE, ...).
     *        Caller computes this via SSZHashTree (separate library).
     * @param signatureCompressed The 96-byte IETF compressed G2 sig
     *        from sync_aggregate.sync_committee_signature.
     *
     * @return ok True iff e(P, H(M)) == e(G1, σ). Reverts (via the
     *         decompress builtins) if either point is malformed.
     */
    function verifySyncCommitteeAggregate(
        bytes aggPubkeyCompressed,
        bytes32 signingRoot,
        bytes signatureCompressed
    ) internal returns (bool ok) {
        bytes aggPk = bls12381DecompressG1(aggPubkeyCompressed);
        return verifySyncCommitteeAggregateG1(aggPk, signingRoot, signatureCompressed);
    }

    /**
     * @notice Same as {verifySyncCommitteeAggregate} but takes an
     *         already-uncompressed 128-byte EIP-2537 G1 aggregate
     *         pubkey. This is the form {aggregateParticipants} returns,
     *         so EthLightClient can avoid a round-trip through compress
     *         + decompress when it builds the aggregate from the
     *         pinned committee on-chain.
     */
    function verifySyncCommitteeAggregateG1(
        bytes aggPubkeyG1,
        bytes32 signingRoot,
        bytes signatureCompressed
    ) internal returns (bool ok) {
        bytes sig = bls12381DecompressG2(signatureCompressed);
        bytes msgG2 = bls12381HashToCurveG2(bytes(signingRoot), _ethDst());
        // Single pairing call: e(-G1, σ) · e(P, H(M)) == 1
        // Each pair is 128B G1 || 256B G2 = 384 bytes; total input 768B.
        return bls12381Pairing(_negG1Gen() + sig + aggPubkeyG1 + msgG2);
    }

    // ─────────────────────────────────────────────────────────────────
    // Aggregation
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Aggregate the participating subset of a sync committee.
     *
     *         Sync committee aggregates are defined by a 64-byte
     *         (=512-bit) bitfield indicating which committee members
     *         signed. The aggregate pubkey for the signing set is
     *         simply the sum of the pubkeys at set bits.
     *
     *         Bit ordering follows SSZ Bitvector[512]: bit 0 of byte 0
     *         is committee index 0, bit 7 of byte 0 is index 7, bit 0
     *         of byte 1 is index 8, etc. (LSB-first within each byte).
     *
     * @param pubkeysCompressed The 512 committee pubkeys, each in
     *        48-byte IETF compressed form. Order matches the bitfield.
     * @param participation 64-byte bitfield from
     *        sync_aggregate.sync_committee_bits.
     *
     * @return aggPubkey 128-byte EIP-2537 G1 aggregate of the signers.
     * @return count Number of participating signers.
     *         Caller MUST check this is ≥ 342 (⅔ of 512) before
     *         honoring the signature; we don't enforce it here so the
     *         function stays a pure aggregation primitive.
     */
    function aggregateParticipants(
        bytes[] pubkeysCompressed,
        bytes participation
    ) internal returns (bytes aggPubkey, uint256 count) {
        require(pubkeysCompressed.length == 512, "BLSVerify: expected 512 pubkeys");
        require(participation.length == 64, "BLSVerify: expected 64-byte bitfield");

        bytes acc;
        bool started = false;
        count = 0;

        for (uint256 i = 0; i < 512; i = i + 1) {
            uint256 byteIdx = i / 8;
            uint256 bitIdx = i % 8;
            uint8 b = uint8(participation[byteIdx]);
            if (((b >> bitIdx) & 1) == 1) {
                bytes pk = bls12381DecompressG1(pubkeysCompressed[i]);
                if (started) {
                    acc = bls12381G1Add(acc + pk);
                } else {
                    acc = pk;
                    started = true;
                }
                count = count + 1;
            }
        }

        require(started, "BLSVerify: zero participants");
        aggPubkey = acc;
    }

    /**
     * @notice Aggregate a variable-size validator set by uint256 bitmap.
     *
     *         Designed for protocols like BSC fast finality (BEP-126)
     *         where the validator set is small (~21–41 active) and
     *         participation is encoded as a uint64 bitmap in the
     *         VoteAttestation. Bit `i` set means `pubkeysCompressed[i]`
     *         participated; bit 0 is LSB.
     *
     *         Bits beyond `pubkeysCompressed.length` MUST be zero; we
     *         revert if a high bit refers to a non-existent validator.
     *         Pubkeys are assumed pre-sorted by the caller (BSC orders
     *         them byte-ascending by consensus address, and the bitmap
     *         indexes into that order).
     *
     * @param pubkeysCompressed Validator BLS voting keys, each in
     *        48-byte IETF compressed G1 form, in the canonical chain
     *        ordering (BSC: ascending consensus address).
     * @param bitmap Participation bitmap (LSB-first). For BSC, this is
     *        VoteAttestation.VoteAddressSet (uint64 widened to uint256).
     *
     * @return aggPubkey 128-byte EIP-2537 G1 aggregate of the signers.
     * @return count Number of participating signers. Caller enforces
     *         the ≥⅔ supermajority threshold.
     */
    function aggregateByBitmap(
        bytes[] pubkeysCompressed,
        uint256 bitmap
    ) internal returns (bytes aggPubkey, uint256 count) {
        uint256 n = pubkeysCompressed.length;
        require(n > 0, "BLSVerify: empty validator set");
        // High bits past the validator count must be unset.
        if (n < 256) {
            uint256 mask = (uint256(1) << n) - 1;
            require((bitmap & ~mask) == 0, "BLSVerify: bitmap has stray bits");
        }

        bytes acc;
        bool started = false;
        count = 0;

        for (uint256 i = 0; i < n; i = i + 1) {
            if (((bitmap >> i) & 1) == 1) {
                bytes pk = bls12381DecompressG1(pubkeysCompressed[i]);
                if (started) {
                    acc = bls12381G1Add(acc + pk);
                } else {
                    acc = pk;
                    started = true;
                }
                count = count + 1;
            }
        }

        require(started, "BLSVerify: zero participants");
        aggPubkey = acc;
    }

    // ─────────────────────────────────────────────────────────────────
    // Bit utility (kept here so EthLightClient can sanity-check
    // participation thresholds without re-implementing the loop).
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Count set bits (popcount) in an SSZ-style bitfield.
     */
    function popcount(bytes bitfield) internal pure returns (uint256 n) {
        n = 0;
        for (uint256 i = 0; i < bitfield.length; i = i + 1) {
            uint8 b = uint8(bitfield[i]);
            // Brian-Kernighan loop: clears the lowest set bit each iteration.
            while (b != 0) {
                b = b & (b - 1);
                n = n + 1;
            }
        }
    }
}

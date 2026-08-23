import "../../concrete/Plonk/PlonkVerifier.sol";
import "./PlonkCommitFixture.sol";

/// @notice Verifies a REAL gnark PLONK proof that carries a Bsb22 commitment
///         (gnark's Committer API -- what the plonky2 wrap circuit's range
///         checks produce). Same stage-by-stage discipline as
///         PlonkVerifier.test.sol: every intermediate is pinned to the Go
///         reference verifier's value, so a failure names the stage.
///
///         What the commitment changes, and what these tests pin:
///           - the key grows a Qcp point + constraint index (32 words);
///           - the proof grows Qcp(zeta) + [Bsb] (27 words);
///           - gamma binds Qcp after Qk; alpha binds [Bsb] before [Z];
///           - PI(zeta) gains hash_fr([Bsb]) * L_{nbPublic+index}(zeta);
///           - the linearised digest gains Qcp(zeta) * [Bsb];
///           - gamma_kzg and the fold gain [Qcp] / Qcp(zeta) as a 7th term.
contract Describe_PlonkVerifierCommit {
    PlonkVerifier verifier;

    function beforeAll() public {
        verifier = new PlonkVerifier();
        verifier.initialize(vkArray(), "cubic-with-bsb22-commitment");
    }

    function vkArray() internal returns (uint256[]) {
        uint256[] memory k = new uint256[](32);
        k[0] = PlonkCommitFixture.DOMAIN_SIZE;
        k[1] = PlonkCommitFixture.OMEGA;
        k[2] = PlonkCommitFixture.INV_DOMAIN_SIZE;
        k[3] = PlonkCommitFixture.COSET_SHIFT;
        k[4] = PlonkCommitFixture.NB_PUBLIC_INPUTS;
        k[5] = PlonkCommitFixture.VK_S1_X;  k[6] = PlonkCommitFixture.VK_S1_Y;
        k[7] = PlonkCommitFixture.VK_S2_X;  k[8] = PlonkCommitFixture.VK_S2_Y;
        k[9] = PlonkCommitFixture.VK_S3_X;  k[10] = PlonkCommitFixture.VK_S3_Y;
        k[11] = PlonkCommitFixture.VK_QL_X; k[12] = PlonkCommitFixture.VK_QL_Y;
        k[13] = PlonkCommitFixture.VK_QR_X; k[14] = PlonkCommitFixture.VK_QR_Y;
        k[15] = PlonkCommitFixture.VK_QM_X; k[16] = PlonkCommitFixture.VK_QM_Y;
        k[17] = PlonkCommitFixture.VK_QO_X; k[18] = PlonkCommitFixture.VK_QO_Y;
        k[19] = PlonkCommitFixture.VK_QK_X; k[20] = PlonkCommitFixture.VK_QK_Y;
        k[21] = PlonkCommitFixture.G2_SRS_0_X_0; k[22] = PlonkCommitFixture.G2_SRS_0_X_1;
        k[23] = PlonkCommitFixture.G2_SRS_0_Y_0; k[24] = PlonkCommitFixture.G2_SRS_0_Y_1;
        k[25] = PlonkCommitFixture.G2_SRS_1_X_0; k[26] = PlonkCommitFixture.G2_SRS_1_X_1;
        k[27] = PlonkCommitFixture.G2_SRS_1_Y_0; k[28] = PlonkCommitFixture.G2_SRS_1_Y_1;
        // Bsb22 section: [Qcp.x, Qcp.y, commitmentConstraintIndex]
        k[29] = PlonkCommitFixture.VK_QCP0_X; k[30] = PlonkCommitFixture.VK_QCP0_Y;
        k[31] = PlonkCommitFixture.VK_COMMITMENT_INDEX0;
        return k;
    }

    /// @dev 24 fixed words, then Qcp(zeta), then [Bsb] -- MarshalSolidity's order.
    function proofArray() internal returns (uint256[]) {
        uint256[] memory p = new uint256[](27);
        p[0] = PlonkCommitFixture.PROOF_L_X;  p[1] = PlonkCommitFixture.PROOF_L_Y;
        p[2] = PlonkCommitFixture.PROOF_R_X;  p[3] = PlonkCommitFixture.PROOF_R_Y;
        p[4] = PlonkCommitFixture.PROOF_O_X;  p[5] = PlonkCommitFixture.PROOF_O_Y;
        p[6] = PlonkCommitFixture.PROOF_H0_X; p[7] = PlonkCommitFixture.PROOF_H0_Y;
        p[8] = PlonkCommitFixture.PROOF_H1_X; p[9] = PlonkCommitFixture.PROOF_H1_Y;
        p[10] = PlonkCommitFixture.PROOF_H2_X; p[11] = PlonkCommitFixture.PROOF_H2_Y;
        p[12] = PlonkCommitFixture.PROOF_L_AT_ZETA;
        p[13] = PlonkCommitFixture.PROOF_R_AT_ZETA;
        p[14] = PlonkCommitFixture.PROOF_O_AT_ZETA;
        p[15] = PlonkCommitFixture.PROOF_S1_AT_ZETA;
        p[16] = PlonkCommitFixture.PROOF_S2_AT_ZETA;
        p[17] = PlonkCommitFixture.PROOF_Z_X; p[18] = PlonkCommitFixture.PROOF_Z_Y;
        p[19] = PlonkCommitFixture.PROOF_Z_AT_ZETA_OMEGA;
        p[20] = PlonkCommitFixture.PROOF_W_ZETA_X; p[21] = PlonkCommitFixture.PROOF_W_ZETA_Y;
        p[22] = PlonkCommitFixture.PROOF_W_ZETA_OMEGA_X; p[23] = PlonkCommitFixture.PROOF_W_ZETA_OMEGA_Y;
        p[24] = PlonkCommitFixture.PROOF_QCP0_AT_ZETA;
        p[25] = PlonkCommitFixture.PROOF_BSB0_X; p[26] = PlonkCommitFixture.PROOF_BSB0_Y;
        return p;
    }

    function publicInputs() internal returns (uint256[]) {
        uint256[] memory pi = new uint256[](2);
        pi[0] = PlonkCommitFixture.PI_0;
        pi[1] = PlonkCommitFixture.PI_1;
        return pi;
    }

    function it_aa_reads_the_commitment_shape_from_the_key() public {
        require(verifier.nbCommitments() == 1, "one commitment expected");
        require(verifier.proofLength() == 27, "27-word proof expected");
    }

    // --- stage 1 -------------------------------------------------------------

    /// @dev gamma sees Qcp; alpha sees [Bsb] -- both transcripts differ from
    ///      the commitment-free shape.
    function it_ab_derives_all_four_challenges() public {
        (uint256 g, uint256 b, uint256 a, uint256 z) =
            verifier.challenges(proofArray(), publicInputs());
        require(g == PlonkCommitFixture.EXP_GAMMA, "gamma mismatch");
        require(b == PlonkCommitFixture.EXP_BETA, "beta mismatch");
        require(a == PlonkCommitFixture.EXP_ALPHA, "alpha mismatch");
        require(z == PlonkCommitFixture.EXP_ZETA, "zeta mismatch");
    }

    // --- stage 2 -------------------------------------------------------------

    /// @dev hash_fr is expand_message_xmd(SHA-256, "BSB22-Plonk", 48); the
    ///      three SHA-256 layouts have to be byte-exact.
    function it_ac_hashes_the_commitment_to_the_field() public {
        uint256 hf = verifier.hashFr(
            PlonkCommitFixture.PROOF_BSB0_X, PlonkCommitFixture.PROOF_BSB0_Y);
        require(hf == PlonkCommitFixture.EXP_HASH_FR0, "hash_fr mismatch");
    }

    function it_ad_computes_the_commitment_contribution() public {
        uint256 v = verifier.commitmentContribution(
            PlonkCommitFixture.EXP_ZETA, PlonkCommitFixture.EXP_ZH, proofArray());
        require(v == PlonkCommitFixture.EXP_PI_COMMIT, "commitment PI term mismatch");
        uint256 pi = verifier.publicInputContribution(
            PlonkCommitFixture.EXP_ZETA, PlonkCommitFixture.EXP_ZH, publicInputs());
        require(PlonkMath.addFr(pi, v) == PlonkCommitFixture.EXP_PI, "PI(zeta) mismatch");
    }

    // --- stage 3 -------------------------------------------------------------

    function it_ae_computes_the_linearised_commitment() public {
        (uint256 x, uint256 y) = verifier.linearisedCommitment(
            proofArray(), PlonkCommitFixture.EXP_GAMMA, PlonkCommitFixture.EXP_BETA,
            PlonkCommitFixture.EXP_ALPHA, PlonkCommitFixture.EXP_ZETA, PlonkCommitFixture.EXP_ZH,
            PlonkCommitFixture.EXP_ALPHA_SQ_L0);
        require(x == PlonkCommitFixture.EXP_LIN_X, "linearised commitment x mismatch");
        require(y == PlonkCommitFixture.EXP_LIN_Y, "linearised commitment y mismatch");
    }

    // --- stage 4 -------------------------------------------------------------

    function it_af_derives_gamma_kzg() public {
        uint256 gk = verifier.gammaKzg(
            proofArray(), PlonkCommitFixture.EXP_ZETA,
            PlonkCommitFixture.EXP_LIN_X, PlonkCommitFixture.EXP_LIN_Y,
            PlonkCommitFixture.EXP_LIN_AT_ZETA);
        require(gk == PlonkCommitFixture.EXP_GAMMA_KZG, "gamma_kzg mismatch");
    }

    function it_ag_folds_the_zeta_openings() public {
        (uint256 x, uint256 y, uint256 v) = verifier.foldState(
            proofArray(), PlonkCommitFixture.EXP_LIN_X, PlonkCommitFixture.EXP_LIN_Y,
            PlonkCommitFixture.EXP_LIN_AT_ZETA, PlonkCommitFixture.EXP_GAMMA_KZG);
        require(x == PlonkCommitFixture.EXP_FOLDED_X, "folded digest x mismatch");
        require(y == PlonkCommitFixture.EXP_FOLDED_Y, "folded digest y mismatch");
        require(v == PlonkCommitFixture.EXP_FOLDED_VALUE, "folded claimed value mismatch");
    }

    function it_ah_folds_the_two_evaluation_points() public {
        (uint256 dx, uint256 dy, uint256 qx, uint256 qy) = verifier.foldPoints(
            proofArray(), PlonkCommitFixture.EXP_FOLDED_X, PlonkCommitFixture.EXP_FOLDED_Y,
            PlonkCommitFixture.EXP_FOLDED_VALUE, PlonkCommitFixture.EXP_ZETA,
            PlonkCommitFixture.EXP_RHO);
        require(dx == PlonkCommitFixture.EXP_FINAL_D_X, "final digest x mismatch");
        require(dy == PlonkCommitFixture.EXP_FINAL_D_Y, "final digest y mismatch");
        require(qx == PlonkCommitFixture.EXP_FINAL_Q_X, "final quotient x mismatch");
        require(qy == PlonkCommitFixture.EXP_FINAL_Q_Y, "final quotient y mismatch");
    }

    // --- end to end ----------------------------------------------------------

    function it_ai_verifies_a_real_gnark_proof_with_a_commitment() public {
        require(verifier.verifyProof(proofArray(), publicInputs()), "valid proof must verify");
    }

    /// @dev The IVerifier byte entry point must accept the 864-byte blob.
    function it_aj_verifies_the_byte_encoded_proof() public {
        uint256[] memory p = proofArray();
        bytes blob = bytes("");
        uint256 i = 0;
        while (i < p.length) {
            blob = blob + PlonkMath.toWord(p[i]);
            i = i + 1;
        }
        require(blob.length == 27 * 32, "blob size");
        require(verifier.verify(blob, publicInputs()), "byte-encoded proof must verify");
    }

    /// @dev Soundness: the commitment is bound (alpha, hash_fr, the fold), so
    ///      substituting another curve point for [Bsb] must fail.
    function it_ak_rejects_a_swapped_commitment_point() public {
        uint256[] memory p = proofArray();
        p[25] = PlonkCommitFixture.PROOF_L_X;
        p[26] = PlonkCommitFixture.PROOF_L_Y;
        require(!verifier.verifyProof(p, publicInputs()), "swapped commitment must not verify");
    }

    /// @dev Soundness: Qcp(zeta) enters the linearised digest and the fold.
    function it_al_rejects_a_tampered_qcp_opening() public {
        uint256[] memory p = proofArray();
        p[24] = PlonkMath.addFr(p[24], 1);
        require(!verifier.verifyProof(p, publicInputs()), "tampered Qcp(zeta) must not verify");
    }

    function it_am_rejects_a_proof_against_the_wrong_public_inputs() public {
        uint256[] memory bad = new uint256[](2);
        bad[0] = PlonkCommitFixture.PI_0;
        bad[1] = PlonkCommitFixture.PI_1 + 1;
        require(!verifier.verifyProof(proofArray(), bad), "wrong public inputs must not verify");
    }

    /// @dev A 24-word proof against a key that expects a commitment is
    ///      malformed, not merely invalid: it reverts.
    function it_an_rejects_the_commitment_free_proof_shape() public {
        uint256[] memory p = proofArray();
        uint256[] memory short = new uint256[](24);
        uint256 i = 0;
        while (i < 24) {
            short[i] = p[i];
            i = i + 1;
        }
        bool rejected = false;
        try {
            verifier.verifyProof(short, publicInputs());
        } catch {
            rejected = true;
        }
        require(rejected, "a 24-word proof must revert against a commitment key");
    }

    /// @dev A key with a partial commitment section (not a multiple of 3
    ///      extra words) is refused at install time.
    function it_ao_refuses_a_ragged_commitment_section() public {
        uint256[] memory k = vkArray();
        uint256[] memory ragged = new uint256[](31);
        uint256 i = 0;
        while (i < 31) {
            ragged[i] = k[i];
            i = i + 1;
        }
        bool ok = true;
        try {
            verifier.initialize(ragged, "ragged");
        } catch {
            ok = false;
        }
        require(!ok, "a ragged key must be refused");
        require(verifier.nbCommitments() == 1, "the installed key must be untouched");
    }

    /// @dev The Qcp point gets the same on-curve check as the other eight.
    function it_ap_refuses_an_off_curve_qcp() public {
        uint256[] memory k = vkArray();
        k[29] = 12279174796801557000000000000000000000000000000000000000000000000000000000000;
        bool ok = true;
        try {
            verifier.initialize(k, "float64-mangled-qcp");
        } catch {
            ok = false;
        }
        require(!ok, "an off-curve Qcp must be refused");
    }
}

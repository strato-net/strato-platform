import "../../concrete/Plonk/PlonkVerifier.sol";
import "./PlonkFixture.sol";

/// @notice Stands in for an unprivileged third party: it does not deploy the
///         verifier, so it does not own it.
contract VkVandal {
    function tryInstall(address verifier, uint256[] key) public returns (bool) {
        bool ok = true;
        try {
            PlonkVerifier(verifier).initialize(key, "hijacked");
        } catch {
            ok = false;
        }
        return ok;
    }
}

/// @notice Verifies a REAL gnark PLONK proof on SolidVM, stage by stage.
///         Each intermediate is checked against the value a Go reference
///         verifier produced while accepting the same proof, so a failure
///         names the stage that broke rather than just reporting that the
///         proof did not verify.
contract Describe_PlonkVerifier {
    PlonkVerifier verifier;

    function beforeAll() public {
        verifier = new PlonkVerifier();
        verifier.initialize(vkArray(), "cubic-x3-plus-x-plus-5");
    }

    function vkArray() internal returns (uint256[]) {
        uint256[] memory k = new uint256[](29);
        k[0] = PlonkFixture.DOMAIN_SIZE;
        k[1] = PlonkFixture.OMEGA;
        k[2] = PlonkFixture.INV_DOMAIN_SIZE;
        k[3] = PlonkFixture.COSET_SHIFT;
        k[4] = PlonkFixture.NB_PUBLIC_INPUTS;
        k[5] = PlonkFixture.VK_S1_X;  k[6] = PlonkFixture.VK_S1_Y;
        k[7] = PlonkFixture.VK_S2_X;  k[8] = PlonkFixture.VK_S2_Y;
        k[9] = PlonkFixture.VK_S3_X;  k[10] = PlonkFixture.VK_S3_Y;
        k[11] = PlonkFixture.VK_QL_X; k[12] = PlonkFixture.VK_QL_Y;
        k[13] = PlonkFixture.VK_QR_X; k[14] = PlonkFixture.VK_QR_Y;
        k[15] = PlonkFixture.VK_QM_X; k[16] = PlonkFixture.VK_QM_Y;
        k[17] = PlonkFixture.VK_QO_X; k[18] = PlonkFixture.VK_QO_Y;
        k[19] = PlonkFixture.VK_QK_X; k[20] = PlonkFixture.VK_QK_Y;
        k[21] = PlonkFixture.G2_SRS_0_X_0; k[22] = PlonkFixture.G2_SRS_0_X_1;
        k[23] = PlonkFixture.G2_SRS_0_Y_0; k[24] = PlonkFixture.G2_SRS_0_Y_1;
        k[25] = PlonkFixture.G2_SRS_1_X_0; k[26] = PlonkFixture.G2_SRS_1_X_1;
        k[27] = PlonkFixture.G2_SRS_1_Y_0; k[28] = PlonkFixture.G2_SRS_1_Y_1;
        return k;
    }

    /// @dev Word index == gnark byte offset / 32, so this is gnark's
    ///      MarshalSolidity blob laid out as field elements.
    function proofArray() internal returns (uint256[]) {
        uint256[] memory p = new uint256[](24);
        p[0] = PlonkFixture.PROOF_L_X;  p[1] = PlonkFixture.PROOF_L_Y;
        p[2] = PlonkFixture.PROOF_R_X;  p[3] = PlonkFixture.PROOF_R_Y;
        p[4] = PlonkFixture.PROOF_O_X;  p[5] = PlonkFixture.PROOF_O_Y;
        p[6] = PlonkFixture.PROOF_H0_X; p[7] = PlonkFixture.PROOF_H0_Y;
        p[8] = PlonkFixture.PROOF_H1_X; p[9] = PlonkFixture.PROOF_H1_Y;
        p[10] = PlonkFixture.PROOF_H2_X; p[11] = PlonkFixture.PROOF_H2_Y;
        p[12] = PlonkFixture.PROOF_L_AT_ZETA;
        p[13] = PlonkFixture.PROOF_R_AT_ZETA;
        p[14] = PlonkFixture.PROOF_O_AT_ZETA;
        p[15] = PlonkFixture.PROOF_S1_AT_ZETA;
        p[16] = PlonkFixture.PROOF_S2_AT_ZETA;
        p[17] = PlonkFixture.PROOF_Z_X; p[18] = PlonkFixture.PROOF_Z_Y;
        p[19] = PlonkFixture.PROOF_Z_AT_ZETA_OMEGA;
        p[20] = PlonkFixture.PROOF_W_ZETA_X; p[21] = PlonkFixture.PROOF_W_ZETA_Y;
        p[22] = PlonkFixture.PROOF_W_ZETA_OMEGA_X; p[23] = PlonkFixture.PROOF_W_ZETA_OMEGA_Y;
        return p;
    }

    function publicInputs() internal returns (uint256[]) {
        uint256[] memory pi = new uint256[](2);
        pi[0] = PlonkFixture.PI_0;
        pi[1] = PlonkFixture.PI_1;
        return pi;
    }

    // --- stage 1 -------------------------------------------------------------

    function it_aa_derives_all_four_challenges() public {
        (uint256 g, uint256 b, uint256 a, uint256 z) =
            verifier.challenges(proofArray(), publicInputs());
        require(g == PlonkFixture.EXP_GAMMA, "gamma mismatch");
        require(b == PlonkFixture.EXP_BETA, "beta mismatch");
        require(a == PlonkFixture.EXP_ALPHA, "alpha mismatch");
        require(z == PlonkFixture.EXP_ZETA, "zeta mismatch");
    }

    // --- stage 2 -------------------------------------------------------------

    function it_ab_evaluates_the_vanishing_polynomial() public {
        require(verifier.vanishing(PlonkFixture.EXP_ZETA) == PlonkFixture.EXP_ZH, "Z_H mismatch");
    }

    function it_ac_computes_the_public_input_contribution() public {
        uint256 pi = verifier.publicInputContribution(
            PlonkFixture.EXP_ZETA, PlonkFixture.EXP_ZH, publicInputs());
        require(pi == PlonkFixture.EXP_PI, "PI(zeta) mismatch");
    }

    function it_ad_computes_alpha_squared_lagrange_zero() public {
        uint256 v = verifier.alphaSquaredLagrangeZero(
            PlonkFixture.EXP_ALPHA, PlonkFixture.EXP_ZETA, PlonkFixture.EXP_ZH);
        require(v == PlonkFixture.EXP_ALPHA_SQ_L0, "alpha^2 L_0 mismatch");
    }

    // --- stage 3 -------------------------------------------------------------

    /// @dev This value is NOT in the proof -- gnark omits it and the verifier
    ///      reconstructs it, which is what binds the opening to the public
    ///      inputs.
    function it_ae_reconstructs_the_linearised_opening() public {
        uint256 v = verifier.linearisedOpening(
            proofArray(), PlonkFixture.EXP_GAMMA, PlonkFixture.EXP_BETA,
            PlonkFixture.EXP_ALPHA, PlonkFixture.EXP_PI, PlonkFixture.EXP_ALPHA_SQ_L0);
        require(v == PlonkFixture.EXP_LIN_AT_ZETA, "linearised opening mismatch");
    }

    function it_af_computes_the_linearised_commitment() public {
        (uint256 x, uint256 y) = verifier.linearisedCommitment(
            proofArray(), PlonkFixture.EXP_GAMMA, PlonkFixture.EXP_BETA,
            PlonkFixture.EXP_ALPHA, PlonkFixture.EXP_ZETA, PlonkFixture.EXP_ZH,
            PlonkFixture.EXP_ALPHA_SQ_L0);
        require(x == PlonkFixture.EXP_LIN_X, "linearised commitment x mismatch");
        require(y == PlonkFixture.EXP_LIN_Y, "linearised commitment y mismatch");
    }

    // --- stage 4 -------------------------------------------------------------

    function it_ag_derives_gamma_kzg() public {
        uint256 gk = verifier.gammaKzg(
            proofArray(), PlonkFixture.EXP_ZETA,
            PlonkFixture.EXP_LIN_X, PlonkFixture.EXP_LIN_Y, PlonkFixture.EXP_LIN_AT_ZETA);
        require(gk == PlonkFixture.EXP_GAMMA_KZG, "gamma_kzg mismatch");
    }

    function it_ah_folds_the_zeta_openings() public {
        (uint256 x, uint256 y, uint256 v) = verifier.foldState(
            proofArray(), PlonkFixture.EXP_LIN_X, PlonkFixture.EXP_LIN_Y,
            PlonkFixture.EXP_LIN_AT_ZETA, PlonkFixture.EXP_GAMMA_KZG);
        require(x == PlonkFixture.EXP_FOLDED_X, "folded digest x mismatch");
        require(y == PlonkFixture.EXP_FOLDED_Y, "folded digest y mismatch");
        require(v == PlonkFixture.EXP_FOLDED_VALUE, "folded claimed value mismatch");
    }

    function it_ai_derives_rho() public {
        uint256 r = verifier.rho(
            proofArray(), PlonkFixture.EXP_FOLDED_X, PlonkFixture.EXP_FOLDED_Y,
            PlonkFixture.EXP_ZETA, PlonkFixture.EXP_GAMMA_KZG);
        require(r == PlonkFixture.EXP_RHO, "rho mismatch");
    }

    function it_aj_folds_the_two_evaluation_points() public {
        (uint256 dx, uint256 dy, uint256 qx, uint256 qy) = verifier.foldPoints(
            proofArray(), PlonkFixture.EXP_FOLDED_X, PlonkFixture.EXP_FOLDED_Y,
            PlonkFixture.EXP_FOLDED_VALUE, PlonkFixture.EXP_ZETA, PlonkFixture.EXP_RHO);
        require(dx == PlonkFixture.EXP_FINAL_D_X, "final digest x mismatch");
        require(dy == PlonkFixture.EXP_FINAL_D_Y, "final digest y mismatch");
        require(qx == PlonkFixture.EXP_FINAL_Q_X, "final quotient x mismatch");
        require(qy == PlonkFixture.EXP_FINAL_Q_Y, "final quotient y mismatch");
    }

    // --- end to end ----------------------------------------------------------

    /// @notice The whole point: a real gnark PLONK proof verifying on SolidVM.
    function it_ak_verifies_a_real_gnark_proof() public {
        require(verifier.verifyProof(proofArray(), publicInputs()), "valid proof must verify");
    }

    /// @dev Soundness: the public inputs are bound into the transcript, so
    ///      claiming a different statement must fail even with a valid proof.
    function it_al_rejects_a_proof_against_the_wrong_public_inputs() public {
        uint256[] memory bad = new uint256[](2);
        bad[0] = PlonkFixture.PI_0;
        bad[1] = PlonkFixture.PI_1 + 1; // y = 36 instead of 35
        require(!verifier.verifyProof(proofArray(), bad), "wrong public inputs must not verify");
    }

    /// @dev Soundness: tampering with any proof element must fail.
    function it_am_rejects_a_tampered_proof() public {
        uint256[] memory p = proofArray();
        p[12] = PlonkMath.addFr(p[12], 1); // perturb L(zeta)
        require(!verifier.verifyProof(p, publicInputs()), "a tampered proof must not verify");
    }

    function it_an_rejects_a_malformed_proof_length() public {
        uint256[] memory short = new uint256[](23);
        bool rejected = false;
        try {
            verifier.verifyProof(short, publicInputs());
        } catch {
            rejected = true;
        }
        require(rejected, "a short proof must revert");
    }

    function it_ao_rejects_the_wrong_public_input_count() public {
        uint256[] memory one = new uint256[](1);
        one[0] = PlonkFixture.PI_0;
        bool rejected = false;
        try {
            verifier.verifyProof(proofArray(), one);
        } catch {
            rejected = true;
        }
        require(rejected, "the wrong public input count must revert");
    }

    function it_ap_reports_its_verifier_id() public {
        require(
            verifier.verifierId() == "plonk-bn254:cubic-x3-plus-x-plus-5",
            "verifier id mismatch"
        );
    }

    /// @notice The verifying key is owner-only. Anyone able to overwrite it
    ///         could halt settlement permanently: every honest proof would
    ///         fail against the wrong key, and redeploying would not help
    ///         because the same party could re-install on the new verifier.
    function it_aq_refuses_a_verifying_key_from_a_non_owner() public {
        VkVandal vandal = new VkVandal();
        require(
            !vandal.tryInstall(address(verifier), vkArray()),
            "a non-owner must not be able to install a verifying key"
        );
        require(
            verifier.verifierId() == "plonk-bn254:cubic-x3-plus-x-plus-5",
            "the installed key must be untouched"
        );
        // and the owner can still rotate it (circuit upgrades need this)
        verifier.initialize(vkArray(), "cubic-x3-plus-x-plus-5");
    }

    /// @notice A key whose G1 words are not curve points must be refused at
    ///         install time. The realistic corruption is not an attacker but
    ///         a float64 JSON tool (jq, a browser console) between -print-vk
    ///         and the install: it rounds the 77-digit words to 17
    ///         significant digits -- still in field range, so only the curve
    ///         equation catches it. Accepted, such a key fails every later
    ///         proveBatch with an ecMul revert far from the install at fault.
    function it_ar_refuses_an_off_curve_verifying_key() public {
        uint256[] memory k = vkArray();
        // What float64 rounding actually produces: 17 significant digits
        // followed by zeros -- in range, off curve.
        k[5] = 12279174796801557000000000000000000000000000000000000000000000000000000000000;
        bool ok = true;
        try {
            verifier.initialize(k, "float64-mangled");
        } catch {
            ok = false;
        }
        require(!ok, "an off-curve verifying key must be refused");
        require(
            verifier.verifierId() == "plonk-bn254:cubic-x3-plus-x-plus-5",
            "the installed key must be untouched"
        );
    }
}

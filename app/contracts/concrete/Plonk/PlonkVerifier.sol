// PATH DEPTH IS DELIBERATE: SolidVM resolves imports relative to the WORKING
// DIRECTORY of the running test, so these are counted from tests/Plonk/.
// concrete/Plonk, libraries/Plonk and tests/Plonk sit at the same depth, so
// one ../../ form resolves from all three -- the same convention the Bridge
// contracts use.
//
// PROVENANCE: lifted from the lambdachain rollup (rollup/contracts/), where it
// verifies the plonky2 wrap on RollupCoreV3. Unchanged apart from the import
// paths above. It is circuit-agnostic by construction -- the verifying key
// lives in storage -- so the bridge's aggregation circuit reuses it as-is.
//
// COST ON STRATO, measured against the merged gas schedule by bracketing a
// verify against the test runner's ceiling:
//
//     ~96,000 gas   2 public inputs, no Bsb22 commitments
//    ~104,000 gas   with one Bsb22 commitment (the shape gnark's emulated
//                   range checks produce, so the shape the bridge circuit
//                   will have)
//
// against a 400,000-gas per-transaction budget. Note that
// publicInputContribution does one modular inversion per public input, so
// public inputs are not free: pack wide bitfields into field elements rather
// than passing them a bit at a time.
import "../../abstract/ERC20/access/Ownable.sol";
import "../../libraries/Plonk/PlonkMath.sol";
import "../../libraries/Plonk/PlonkTranscript.sol";
import "../../libraries/Plonk/IVerifier.sol";

/**
 * @title PlonkVerifier
 * @notice On-chain verifier for gnark PLONK proofs over BN254.
 *
 * @dev gnark's own exported verifier is one ~1250-line Yul assembly block and
 *      cannot run here: SolidVM supports exactly one assembly pattern
 *      (`x := mload(add(y, 32))`). This is a reimplementation in plain SolidVM
 *      Solidity, built against a Go reference verifier that accepts a real
 *      gnark proof using only the operations available here. Every stage is
 *      pinned to that reference's intermediates in
 *      tests/Rollup/PlonkVerifier.test.sol.
 *
 * @dev THE VERIFYING KEY LIVES IN STORAGE, not in baked constants as gnark
 *      generates. One deployed verifier therefore serves any circuit, and a
 *      circuit change is an `initialize` call rather than a redeployment --
 *      which is what makes RollupCore's verifier rotation meaningful.
 *
 * @dev A FAILED PROOF RETURNS FALSE; it does not revert. Only malformed input
 *      reverts. RollupCore distinguishes the two: an invalid proof is a
 *      rejected batch, a malformed one is a broken caller.
 *
 * @dev BSB22 COMMITMENTS (2026-08-18). A gnark circuit that uses the
 *      Committer API (the plonky2 wrap does, through its range checks) puts
 *      one extra selector per commitment in the key and one opening plus
 *      one point per commitment in the proof. This verifier accepts any
 *      number of them: the key's optional tail declares how many (three
 *      words each), the proof grows three words each, and gamma / alpha /
 *      the public-input term / the linearised digest / gamma_kzg / the fold
 *      each pick up their commitment terms exactly where gnark's verifier
 *      puts them (plonkgen/PROTOCOL.md §5b). A key without the tail is the
 *      classic 24-word-proof shape, byte for byte as before.
 */
contract PlonkVerifier is IVerifier, Ownable {
    // Verifying key layout. Flat rather than a struct because the indices are
    // referenced from the generator and the tests, and a flat array keeps
    // those three in sync by construction.
    uint256 constant VK_DOMAIN_SIZE = 0;
    uint256 constant VK_OMEGA = 1;
    uint256 constant VK_INV_DOMAIN_SIZE = 2;
    uint256 constant VK_COSET_SHIFT = 3;
    uint256 constant VK_NB_PUBLIC_INPUTS = 4;
    uint256 constant VK_S1 = 5;   // .. 6
    uint256 constant VK_S2 = 7;   // .. 8
    uint256 constant VK_S3 = 9;   // .. 10
    uint256 constant VK_QL = 11;  // .. 12
    uint256 constant VK_QR = 13;  // .. 14
    uint256 constant VK_QM = 15;  // .. 16
    uint256 constant VK_QO = 17;  // .. 18
    uint256 constant VK_QK = 19;  // .. 20
    uint256 constant VK_G2_0 = 21; // .. 24 (x1, x0, y1, y0 -- EIP-197 order)
    uint256 constant VK_G2_1 = 25; // .. 28
    uint256 constant VK_LENGTH = 29;
    // Optional Bsb22 section, three words per committed wire (gnark's
    // Committer API; the plonky2 wrap circuit has exactly one, from its range
    // checks): [Qcp_i.x, Qcp_i.y, commitmentConstraintIndex_i]. A key with
    // no section is the classic 24-word-proof shape.
    uint256 constant VK_COMMITMENT_WORDS = 3;

    // Proof word layout. Word index == gnark byte offset / 32, so this matches
    // gnark's MarshalSolidity blob exactly.
    uint256 constant P_L = 0;    // .. 1
    uint256 constant P_R = 2;    // .. 3
    uint256 constant P_O = 4;    // .. 5
    uint256 constant P_H0 = 6;   // .. 7
    uint256 constant P_H1 = 8;   // .. 9
    uint256 constant P_H2 = 10;  // .. 11
    uint256 constant P_L_AT_ZETA = 12;
    uint256 constant P_R_AT_ZETA = 13;
    uint256 constant P_O_AT_ZETA = 14;
    uint256 constant P_S1_AT_ZETA = 15;
    uint256 constant P_S2_AT_ZETA = 16;
    uint256 constant P_Z = 17;   // .. 18
    uint256 constant P_Z_AT_ZETA_OMEGA = 19;
    uint256 constant P_W_ZETA = 20;        // .. 21
    uint256 constant P_W_ZETA_OMEGA = 22;  // .. 23
    uint256 constant PROOF_LENGTH = 24;
    // Bsb22 tail, per MarshalSolidity: first ALL the openings Qcp_i(zeta)
    // (one word each), then ALL the commitment points (x, y). So for n
    // commitments the proof is 24 + 3n words: word 24+i is Qcp_i(zeta) and
    // words 24+n+2i, 24+n+2i+1 are [Bsb_i].
    uint256 constant PROOF_COMMITMENT_WORDS = 3;

    uint256[] public record vk;
    string public record circuitId;

    event VerifyingKeyInstalled(string id, uint256 domainSize);

    /// @dev The deployer owns the verifier and is the only party who may
    ///      install a verifying key. Without this, ANY address could
    ///      overwrite `vk` on a deployed verifier at any time -- not a theft
    ///      path (RollupCore.proveBatch is onlyProver), but a permanent,
    ///      repeatable liveness attack: overwrite the key and every honest
    ///      proof fails, halting settlement. Recovery would mean deploying a
    ///      fresh verifier, which the same attacker could immediately
    ///      re-initialize.
    constructor() Ownable(msg.sender) {}

    /// @notice Install a verifying key. `id` names the circuit it belongs to,
    ///         and is recorded against every batch this verifier proves.
    ///
    /// @dev Deliberately re-callable by the owner: the verifying key is
    ///      specific to a circuit shape AND to the trusted-setup ceremony, so
    ///      a circuit upgrade legitimately needs to rotate it. Rotating it
    ///      invalidates proofs for batches committed under the old key, so
    ///      the procedure is: drain the proving queue, rotate, restart the
    ///      node (see RUNBOOK.md).
    function initialize(uint256[] key, string id) public onlyOwner {
        require(key.length >= VK_LENGTH, "PlonkVerifier: bad verifying key length");
        require(
            (key.length - VK_LENGTH) % VK_COMMITMENT_WORDS == 0,
            "PlonkVerifier: bad verifying key length"
        );
        require(key[VK_DOMAIN_SIZE] > 1, "PlonkVerifier: bad domain size");
        // The eight G1 commitments (words 5..20, contiguous) must be real
        // curve points. The failure this catches is operational, not
        // adversarial: the 77-digit words do not survive a float64 JSON tool
        // (jq, a JS console) -- they come out rounded to 17 significant
        // digits, still in range, and the first symptom would otherwise be
        // an on-curve revert at proveBatch, far from the install at fault.
        for (uint256 i = VK_S1; i < VK_G2_0; i += 2) {
            require(
                PlonkMath.g1IsOnCurve(key[i], key[i + 1]),
                "PlonkVerifier: verifying-key G1 point is not on the curve"
            );
        }
        // ...and so must every Bsb22 selector commitment; its constraint index
        // must be a Lagrange index inside the domain.
        for (uint256 j = VK_LENGTH; j < key.length; j += VK_COMMITMENT_WORDS) {
            require(
                PlonkMath.g1IsOnCurve(key[j], key[j + 1]),
                "PlonkVerifier: verifying-key Qcp point is not on the curve"
            );
            require(
                key[j + 2] + key[VK_NB_PUBLIC_INPUTS] < key[VK_DOMAIN_SIZE],
                "PlonkVerifier: commitment index outside the domain"
            );
        }
        vk = key;
        circuitId = id;
        emit VerifyingKeyInstalled(id, key[VK_DOMAIN_SIZE]);
    }

    function verifierId() public override returns (string) {
        return "plonk-bn254:" + circuitId;
    }

    /// @notice Number of Bsb22 commitments the installed key expects.
    function nbCommitments() public returns (uint256) {
        return (vk.length - VK_LENGTH) / VK_COMMITMENT_WORDS;
    }

    /// @notice Total proof length in words for the installed key.
    function proofLength() public returns (uint256) {
        return PROOF_LENGTH + PROOF_COMMITMENT_WORDS * nbCommitments();
    }

    /// @dev Word index of Qcp_i(zeta) in the proof.
    function pQcpAtZeta(uint256 i) internal returns (uint256) {
        return PROOF_LENGTH + i;
    }

    /// @dev Word index of [Bsb_i].x in the proof (y follows).
    function pBsb(uint256 i, uint256 nb) internal returns (uint256) {
        return PROOF_LENGTH + nb + 2 * i;
    }

    /// @dev Word index of Qcp_i.x in the key (y, then the constraint index, follow).
    function vkQcp(uint256 i) internal returns (uint256) {
        return VK_LENGTH + VK_COMMITMENT_WORDS * i;
    }

    // -------------------------------------------------------------------------
    // Stage 1: challenges
    // -------------------------------------------------------------------------

    /// @return gamma, beta, alpha, zeta
    function challenges(uint256[] p, uint256[] pi)
        public
        returns (uint256, uint256, uint256, uint256)
    {
        bytes vkw = bytes("");
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_S1], vk[VK_S1 + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_S2], vk[VK_S2 + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_S3], vk[VK_S3 + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_QL], vk[VK_QL + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_QR], vk[VK_QR + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_QM], vk[VK_QM + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_QO], vk[VK_QO + 1]);
        vkw = PlonkTranscript.appendG1(vkw, vk[VK_QK], vk[VK_QK + 1]);
        uint256 nb = nbCommitments();
        uint256 c = 0;
        while (c < nb) {
            // Bsb22 selectors bind after Qk, before the public inputs
            vkw = PlonkTranscript.appendG1(vkw, vk[vkQcp(c)], vk[vkQcp(c) + 1]);
            c = c + 1;
        }

        bytes piw = bytes("");
        uint256 i = 0;
        while (i < pi.length) {
            piw = piw + PlonkMath.toWord(pi[i]);
            i = i + 1;
        }

        bytes lro = bytes("");
        lro = PlonkTranscript.appendG1(lro, p[P_L], p[P_L + 1]);
        lro = PlonkTranscript.appendG1(lro, p[P_R], p[P_R + 1]);
        lro = PlonkTranscript.appendG1(lro, p[P_O], p[P_O + 1]);

        (bytes gRaw, uint256 gamma) = PlonkTranscript.deriveGamma(vkw, piw, lro);
        (bytes bRaw, uint256 beta) = PlonkTranscript.deriveBeta(gRaw);

        // alpha binds the Bsb22 commitments FIRST, then [Z]
        bytes zw = bytes("");
        c = 0;
        while (c < nb) {
            zw = PlonkTranscript.appendG1(zw, p[pBsb(c, nb)], p[pBsb(c, nb) + 1]);
            c = c + 1;
        }
        zw = PlonkTranscript.appendG1(zw, p[P_Z], p[P_Z + 1]);
        (bytes aRaw, uint256 alpha) = PlonkTranscript.deriveAlpha(bRaw, zw);

        bytes hw = bytes("");
        hw = PlonkTranscript.appendG1(hw, p[P_H0], p[P_H0 + 1]);
        hw = PlonkTranscript.appendG1(hw, p[P_H1], p[P_H1 + 1]);
        hw = PlonkTranscript.appendG1(hw, p[P_H2], p[P_H2 + 1]);
        uint256 zeta = PlonkTranscript.deriveZeta(aRaw, hw);

        return (gamma, beta, alpha, zeta);
    }

    // -------------------------------------------------------------------------
    // Stage 2: vanishing polynomial, public inputs, alpha^2 * L_0
    // -------------------------------------------------------------------------

    /**
     * @notice Z_H(zeta) = zeta^n - 1.
     * @dev Reverts when zeta is an n-th root of unity. gnark's inverses would
     *      blow up a step later anyway; failing here says why.
     */
    function vanishing(uint256 zeta) public returns (uint256) {
        uint256 zh = PlonkMath.subFr(PlonkMath.powFr(zeta, vk[VK_DOMAIN_SIZE]), 1);
        require(zh != 0, "PlonkVerifier: zeta is a root of the domain");
        return zh;
    }

    /**
     * @notice PI(zeta) = sum_i L_i(zeta) * pi_i, with
     *         L_i(z) = w^i * Z_H(z) / (n * (z - w^i)).
     * @dev gnark batch-inverts the denominators with the Montgomery trick;
     *      inverting each is equivalent, and the saving is gas rather than
     *      correctness.
     */
    function publicInputContribution(uint256 zeta, uint256 zh, uint256[] pi)
        public
        returns (uint256)
    {
        uint256 acc = 0;
        uint256 wi = 1;
        uint256 i = 0;
        while (i < pi.length) {
            uint256 den = PlonkMath.invFr(PlonkMath.subFr(zeta, wi));
            uint256 li = PlonkMath.mulFr(
                PlonkMath.mulFr(PlonkMath.mulFr(wi, zh), vk[VK_INV_DOMAIN_SIZE]),
                den
            );
            acc = PlonkMath.addFr(acc, PlonkMath.mulFr(li, pi[i]));
            wi = PlonkMath.mulFr(wi, vk[VK_OMEGA]);
            i = i + 1;
        }
        return acc;
    }

    /**
     * @notice The Bsb22 commitments' share of PI(zeta): each committed wire
     *         behaves as one more public input, hash_fr([Bsb_i]), sitting at
     *         Lagrange index nbPublicInputs + commitmentConstraintIndex_i.
     * @dev Zero when the key has no commitment section.
     */
    function commitmentContribution(uint256 zeta, uint256 zh, uint256[] p)
        public
        returns (uint256)
    {
        uint256 nb = nbCommitments();
        uint256 acc = 0;
        uint256 i = 0;
        while (i < nb) {
            uint256 hf = hashFr(p[pBsb(i, nb)], p[pBsb(i, nb) + 1]);
            uint256 wi = PlonkMath.powFr(
                vk[VK_OMEGA], vk[VK_NB_PUBLIC_INPUTS] + vk[vkQcp(i) + 2]);
            uint256 li = PlonkMath.mulFr(
                PlonkMath.mulFr(PlonkMath.mulFr(wi, zh), vk[VK_INV_DOMAIN_SIZE]),
                PlonkMath.invFr(PlonkMath.subFr(zeta, wi))
            );
            acc = PlonkMath.addFr(acc, PlonkMath.mulFr(hf, li));
            i = i + 1;
        }
        return acc;
    }

    /**
     * @notice gnark's hash-to-field of a commitment point: expand_message_xmd
     *         (SHA-256, DST "BSB22-Plonk", 48 bytes) of x‖y, read big-endian
     *         mod r. Byte for byte:
     *           b0 = sha256(0x00×64 ‖ x ‖ y ‖ 0x00 0x30 0x00 ‖ DST ‖ 0x0b)
     *           b1 = sha256(b0 ‖ 0x01 ‖ DST ‖ 0x0b)
     *           b2 = sha256((b0 xor b1) ‖ 0x02 ‖ DST ‖ 0x0b)
     *           res = (b1 ‖ b2[:16]) mod r = (b1·2^128 + b2>>128) mod r
     * @dev The 64 leading zeros are one SHA-256 block (Z_pad); 0x0030 is
     *      the 48-byte output length; 0x0b is the DST length. Single bytes
     *      are built with bytes(uint256(n)) -- minimal big-endian, so exactly
     *      one byte for 1..255 -- and the zero byte with bytes("\x00").
     */
    function hashFr(uint256 x, uint256 y) public returns (uint256) {
        bytes dst = bytes("BSB22-Plonk") + bytes(uint256(0x0b));
        bytes zero = bytes("\x00");
        bytes zpad = bytes("");
        uint256 i = 0;
        while (i < 64) {
            zpad = zpad + zero;
            i = i + 1;
        }
        bytes m0 = zpad + PlonkMath.toWord(x) + PlonkMath.toWord(y)
            + zero + bytes(uint256(0x30)) + zero + dst;
        bytes b0 = sha256(m0);
        bytes b1 = sha256(b0 + bytes(uint256(1)) + dst);
        bytes b2 = sha256(
            PlonkMath.toWord(uint256(b0) ^ uint256(b1)) + bytes(uint256(2)) + dst);
        uint256 hi = PlonkMath.mulFr(uint256(b1), 1 << 128);
        return PlonkMath.addFr(hi, uint256(b2) >> 128);
    }

    /// @notice alpha^2 * L_0(zeta).
    function alphaSquaredLagrangeZero(uint256 alpha, uint256 zeta, uint256 zh)
        public
        returns (uint256)
    {
        uint256 l0 = PlonkMath.mulFr(
            PlonkMath.mulFr(zh, vk[VK_INV_DOMAIN_SIZE]),
            PlonkMath.invFr(PlonkMath.subFr(zeta, 1))
        );
        return PlonkMath.mulFr(PlonkMath.mulFr(alpha, alpha), l0);
    }

    // -------------------------------------------------------------------------
    // Stage 3: the linearised polynomial
    // -------------------------------------------------------------------------

    /**
     * @notice The claimed evaluation of the linearised polynomial at zeta.
     * @dev NOT taken from the proof -- gnark omits it from the blob and the
     *      verifier reconstructs it, which is what binds the opening to the
     *      public inputs. Note the negation wrapping the whole expression.
     */
    function linearisedOpening(
        uint256[] p,
        uint256 gamma,
        uint256 beta,
        uint256 alpha,
        uint256 piZeta,
        uint256 alphaSqL0
    ) public returns (uint256) {
        uint256 a = PlonkMath.addFr(
            PlonkMath.addFr(p[P_L_AT_ZETA], PlonkMath.mulFr(beta, p[P_S1_AT_ZETA])), gamma);
        uint256 b = PlonkMath.addFr(
            PlonkMath.addFr(p[P_R_AT_ZETA], PlonkMath.mulFr(beta, p[P_S2_AT_ZETA])), gamma);
        uint256 c = PlonkMath.addFr(p[P_O_AT_ZETA], gamma);

        uint256 term = PlonkMath.mulFr(
            PlonkMath.mulFr(PlonkMath.mulFr(alpha, p[P_Z_AT_ZETA_OMEGA]), PlonkMath.mulFr(a, b)),
            c
        );
        uint256 inner = PlonkMath.subFr(PlonkMath.addFr(piZeta, term), alphaSqL0);
        return PlonkMath.subFr(0, inner);
    }

    /**
     * @notice The linearised polynomial commitment.
     * @dev Three things here are easy to get wrong and silent when wrong:
     *      [Qk] enters with coefficient 1 (an add, not a mul); [S3] appears
     *      only here, never in the fold; and folded_h uses Horner from H2 down
     *      to H0 with the scaling applied after, then is negated.
     */
    function linearisedCommitment(
        uint256[] p,
        uint256 gamma,
        uint256 beta,
        uint256 alpha,
        uint256 zeta,
        uint256 zh,
        uint256 alphaSqL0
    ) public returns (uint256, uint256) {
        uint256 a = PlonkMath.addFr(
            PlonkMath.addFr(p[P_L_AT_ZETA], PlonkMath.mulFr(beta, p[P_S1_AT_ZETA])), gamma);
        uint256 b = PlonkMath.addFr(
            PlonkMath.addFr(p[P_R_AT_ZETA], PlonkMath.mulFr(beta, p[P_S2_AT_ZETA])), gamma);
        uint256 s1 = PlonkMath.mulFr(
            PlonkMath.mulFr(PlonkMath.mulFr(alpha, beta), p[P_Z_AT_ZETA_OMEGA]),
            PlonkMath.mulFr(a, b)
        );

        uint256 bz = PlonkMath.mulFr(beta, zeta);
        uint256 k = vk[VK_COSET_SHIFT];
        uint256 u = PlonkMath.addFr(PlonkMath.addFr(bz, p[P_L_AT_ZETA]), gamma);
        uint256 v = PlonkMath.addFr(
            PlonkMath.addFr(PlonkMath.mulFr(bz, k), p[P_R_AT_ZETA]), gamma);
        uint256 w = PlonkMath.addFr(
            PlonkMath.addFr(PlonkMath.mulFr(bz, PlonkMath.mulFr(k, k)), p[P_O_AT_ZETA]), gamma);
        uint256 s2 = PlonkMath.addFr(
            PlonkMath.subFr(0, PlonkMath.mulFr(alpha, PlonkMath.mulFr(PlonkMath.mulFr(u, v), w))),
            alphaSqL0
        );

        // folded_h = -Z_H(zeta) * (H0 + t*H1 + t^2*H2), t = zeta^(n+2)
        uint256 t = PlonkMath.powFr(zeta, vk[VK_DOMAIN_SIZE] + 2);
        (uint256 hx, uint256 hy) = PlonkMath.g1Mul(p[P_H2], p[P_H2 + 1], t);
        (hx, hy) = PlonkMath.g1Add(hx, hy, p[P_H1], p[P_H1 + 1]);
        (hx, hy) = PlonkMath.g1Mul(hx, hy, t);
        (hx, hy) = PlonkMath.g1Add(hx, hy, p[P_H0], p[P_H0 + 1]);
        (hx, hy) = PlonkMath.g1Mul(hx, hy, zh);
        (hx, hy) = PlonkMath.g1Neg(hx, hy);

        (uint256 lx, uint256 ly) = PlonkMath.g1Mul(vk[VK_QL], vk[VK_QL + 1], p[P_L_AT_ZETA]);
        (lx, ly) = PlonkMath.g1MulAccumulate(lx, ly, vk[VK_QR], vk[VK_QR + 1], p[P_R_AT_ZETA]);
        (lx, ly) = PlonkMath.g1MulAccumulate(
            lx, ly, vk[VK_QM], vk[VK_QM + 1],
            PlonkMath.mulFr(p[P_L_AT_ZETA], p[P_R_AT_ZETA]));
        (lx, ly) = PlonkMath.g1MulAccumulate(lx, ly, vk[VK_QO], vk[VK_QO + 1], p[P_O_AT_ZETA]);
        (lx, ly) = PlonkMath.g1Add(lx, ly, vk[VK_QK], vk[VK_QK + 1]); // coefficient 1
        uint256 nb = nbCommitments();
        uint256 c = 0;
        while (c < nb) {
            // Bsb22: Qcp_i(zeta) * [Bsb_i]
            (lx, ly) = PlonkMath.g1MulAccumulate(
                lx, ly, p[pBsb(c, nb)], p[pBsb(c, nb) + 1], p[pQcpAtZeta(c)]);
            c = c + 1;
        }
        (lx, ly) = PlonkMath.g1MulAccumulate(lx, ly, vk[VK_S3], vk[VK_S3 + 1], s1);
        (lx, ly) = PlonkMath.g1MulAccumulate(lx, ly, p[P_Z], p[P_Z + 1], s2);
        (lx, ly) = PlonkMath.g1Add(lx, ly, hx, hy);
        return (lx, ly);
    }

    // -------------------------------------------------------------------------
    // Stage 4: fold and pair
    // -------------------------------------------------------------------------

    /// @notice The gamma_kzg transcript. Its first word is the REDUCED zeta.
    function gammaKzg(
        uint256[] p,
        uint256 zeta,
        uint256 linX,
        uint256 linY,
        uint256 linAtZeta
    ) public returns (uint256) {
        bytes body = bytes("");
        body = PlonkTranscript.appendG1(body, linX, linY);
        body = PlonkTranscript.appendG1(body, p[P_L], p[P_L + 1]);
        body = PlonkTranscript.appendG1(body, p[P_R], p[P_R + 1]);
        body = PlonkTranscript.appendG1(body, p[P_O], p[P_O + 1]);
        body = PlonkTranscript.appendG1(body, vk[VK_S1], vk[VK_S1 + 1]);
        body = PlonkTranscript.appendG1(body, vk[VK_S2], vk[VK_S2 + 1]);
        uint256 nb = nbCommitments();
        uint256 c = 0;
        while (c < nb) {
            body = PlonkTranscript.appendG1(body, vk[vkQcp(c)], vk[vkQcp(c) + 1]);
            c = c + 1;
        }
        body = body + PlonkMath.toWord(linAtZeta);
        body = body + PlonkMath.toWord(p[P_L_AT_ZETA]);
        body = body + PlonkMath.toWord(p[P_R_AT_ZETA]);
        body = body + PlonkMath.toWord(p[P_O_AT_ZETA]);
        body = body + PlonkMath.toWord(p[P_S1_AT_ZETA]);
        body = body + PlonkMath.toWord(p[P_S2_AT_ZETA]);
        c = 0;
        while (c < nb) {
            body = body + PlonkMath.toWord(p[pQcpAtZeta(c)]);
            c = c + 1;
        }
        body = body + PlonkMath.toWord(p[P_Z_AT_ZETA_OMEGA]);
        return PlonkTranscript.deriveGammaKzg(zeta, body);
    }

    /**
     * @notice Batch the openings at zeta into a single digest and value.
     * @dev Powers of gamma_kzg start at gamma^1: the linearised term carries
     *      coefficient 1. [S1] and [S2] come from the verifying key here,
     *      while [S3] appeared only in the linearised commitment.
     */
    function foldState(uint256[] p, uint256 linX, uint256 linY, uint256 linAtZeta, uint256 gk)
        public
        returns (uint256, uint256, uint256)
    {
        uint256 g1 = gk;
        uint256 g2 = PlonkMath.mulFr(g1, gk);
        uint256 g3 = PlonkMath.mulFr(g2, gk);
        uint256 g4 = PlonkMath.mulFr(g3, gk);
        uint256 g5 = PlonkMath.mulFr(g4, gk);

        (uint256 fx, uint256 fy) = PlonkMath.g1MulAccumulate(linX, linY, p[P_L], p[P_L + 1], g1);
        (fx, fy) = PlonkMath.g1MulAccumulate(fx, fy, p[P_R], p[P_R + 1], g2);
        (fx, fy) = PlonkMath.g1MulAccumulate(fx, fy, p[P_O], p[P_O + 1], g3);
        (fx, fy) = PlonkMath.g1MulAccumulate(fx, fy, vk[VK_S1], vk[VK_S1 + 1], g4);
        (fx, fy) = PlonkMath.g1MulAccumulate(fx, fy, vk[VK_S2], vk[VK_S2 + 1], g5);

        uint256 val = linAtZeta;
        val = PlonkMath.addFr(val, PlonkMath.mulFr(g1, p[P_L_AT_ZETA]));
        val = PlonkMath.addFr(val, PlonkMath.mulFr(g2, p[P_R_AT_ZETA]));
        val = PlonkMath.addFr(val, PlonkMath.mulFr(g3, p[P_O_AT_ZETA]));
        val = PlonkMath.addFr(val, PlonkMath.mulFr(g4, p[P_S1_AT_ZETA]));
        val = PlonkMath.addFr(val, PlonkMath.mulFr(g5, p[P_S2_AT_ZETA]));

        // Bsb22: [Qcp_i] with Qcp_i(zeta), powers continuing from gamma^6
        uint256 nb = nbCommitments();
        uint256 gi = g5;
        uint256 c = 0;
        while (c < nb) {
            gi = PlonkMath.mulFr(gi, gk);
            (fx, fy) = PlonkMath.g1MulAccumulate(fx, fy, vk[vkQcp(c)], vk[vkQcp(c) + 1], gi);
            val = PlonkMath.addFr(val, PlonkMath.mulFr(gi, p[pQcpAtZeta(c)]));
            c = c + 1;
        }

        return (fx, fy, val);
    }

    /// @notice The rho transcript. No ascii prefix; exactly ten words.
    function rho(uint256[] p, uint256 fx, uint256 fy, uint256 zeta, uint256 gk)
        public
        returns (uint256)
    {
        bytes body = bytes("");
        body = PlonkTranscript.appendG1(body, fx, fy);
        body = PlonkTranscript.appendG1(body, p[P_W_ZETA], p[P_W_ZETA + 1]);
        body = PlonkTranscript.appendG1(body, p[P_Z], p[P_Z + 1]);
        body = PlonkTranscript.appendG1(body, p[P_W_ZETA_OMEGA], p[P_W_ZETA_OMEGA + 1]);
        body = body + PlonkMath.toWord(zeta);
        body = body + PlonkMath.toWord(gk);
        return PlonkTranscript.deriveRho(body);
    }

    /**
     * @notice Fold the two evaluation points into the final pairing inputs.
     * @return digestX, digestY, negated quotientX, quotientY
     */
    function foldPoints(
        uint256[] p,
        uint256 fx,
        uint256 fy,
        uint256 foldedValue,
        uint256 zeta,
        uint256 r
    ) public returns (uint256, uint256, uint256, uint256) {
        // Q = W_zeta + rho * W_zetaOmega
        (uint256 qx, uint256 qy) = PlonkMath.g1MulAccumulate(
            p[P_W_ZETA], p[P_W_ZETA + 1], p[P_W_ZETA_OMEGA], p[P_W_ZETA_OMEGA + 1], r);

        // D = folded + rho*[Z] - [foldedValue + rho*Z(zeta*omega)]_1
        (uint256 dx, uint256 dy) = PlonkMath.g1MulAccumulate(fx, fy, p[P_Z], p[P_Z + 1], r);
        uint256 evals = PlonkMath.addFr(
            foldedValue, PlonkMath.mulFr(r, p[P_Z_AT_ZETA_OMEGA]));
        (uint256 ex, uint256 ey) = PlonkMath.g1Mul(1, 2, evals); // [1]_1 is the generator
        (ex, ey) = PlonkMath.g1Neg(ex, ey);
        (dx, dy) = PlonkMath.g1Add(dx, dy, ex, ey);

        // D += zeta*W_zeta + (rho*zeta*omega)*W_zetaOmega
        (dx, dy) = PlonkMath.g1MulAccumulate(dx, dy, p[P_W_ZETA], p[P_W_ZETA + 1], zeta);
        uint256 zw = PlonkMath.mulFr(zeta, vk[VK_OMEGA]);
        (dx, dy) = PlonkMath.g1MulAccumulate(
            dx, dy, p[P_W_ZETA_OMEGA], p[P_W_ZETA_OMEGA + 1], PlonkMath.mulFr(r, zw));

        (qx, qy) = PlonkMath.g1Neg(qx, qy);
        return (dx, dy, qx, qy);
    }

    // -------------------------------------------------------------------------
    // Entry points
    // -------------------------------------------------------------------------

    /**
     * @notice Verify a proof supplied as field-element words: 24, plus three
     *         per Bsb22 commitment the installed key expects.
     * @dev Returns false on a failed pairing; reverts only on malformed input.
     */
    function verifyProof(uint256[] p, uint256[] pi) public returns (bool) {
        require(vk.length >= VK_LENGTH, "PlonkVerifier: not initialized");
        require(p.length == proofLength(), "PlonkVerifier: bad proof length");
        require(pi.length == vk[VK_NB_PUBLIC_INPUTS], "PlonkVerifier: wrong public input count");

        uint256 i = 0;
        while (i < pi.length) {
            require(pi[i] < PlonkMath.R_MOD, "PlonkVerifier: public input not in field");
            i = i + 1;
        }
        // the five wire/permutation openings and the shifted grand-product value
        require(p[P_L_AT_ZETA] < PlonkMath.R_MOD, "PlonkVerifier: L(zeta) not in field");
        require(p[P_R_AT_ZETA] < PlonkMath.R_MOD, "PlonkVerifier: R(zeta) not in field");
        require(p[P_O_AT_ZETA] < PlonkMath.R_MOD, "PlonkVerifier: O(zeta) not in field");
        require(p[P_S1_AT_ZETA] < PlonkMath.R_MOD, "PlonkVerifier: S1(zeta) not in field");
        require(p[P_S2_AT_ZETA] < PlonkMath.R_MOD, "PlonkVerifier: S2(zeta) not in field");
        require(p[P_Z_AT_ZETA_OMEGA] < PlonkMath.R_MOD, "PlonkVerifier: Z(zw) not in field");
        uint256 nb = nbCommitments();
        uint256 c = 0;
        while (c < nb) {
            require(p[pQcpAtZeta(c)] < PlonkMath.R_MOD, "PlonkVerifier: Qcp(zeta) not in field");
            c = c + 1;
        }

        (uint256 gamma, uint256 beta, uint256 alpha, uint256 zeta) = challenges(p, pi);
        uint256 zh = vanishing(zeta);
        uint256 piZeta = PlonkMath.addFr(
            publicInputContribution(zeta, zh, pi), commitmentContribution(zeta, zh, p));
        uint256 asl0 = alphaSquaredLagrangeZero(alpha, zeta, zh);
        uint256 linAtZeta = linearisedOpening(p, gamma, beta, alpha, piZeta, asl0);
        (uint256 linX, uint256 linY) =
            linearisedCommitment(p, gamma, beta, alpha, zeta, zh, asl0);

        uint256 gk = gammaKzg(p, zeta, linX, linY, linAtZeta);
        (uint256 fx, uint256 fy, uint256 fv) = foldState(p, linX, linY, linAtZeta, gk);
        uint256 r = rho(p, fx, fy, zeta, gk);
        (uint256 dx, uint256 dy, uint256 qx, uint256 qy) =
            foldPoints(p, fx, fy, fv, zeta, r);

        // e(D, [1]_2) * e(-Q, [s]_2) == 1
        // The folded digest pairs with the G2 GENERATOR and the negated
        // quotient with the TAU point; swapping them is a silent break.
        uint256[] memory pairs = new uint256[](12);
        pairs[0] = dx;
        pairs[1] = dy;
        pairs[2] = vk[VK_G2_0];
        pairs[3] = vk[VK_G2_0 + 1];
        pairs[4] = vk[VK_G2_0 + 2];
        pairs[5] = vk[VK_G2_0 + 3];
        pairs[6] = qx;
        pairs[7] = qy;
        pairs[8] = vk[VK_G2_1];
        pairs[9] = vk[VK_G2_1 + 1];
        pairs[10] = vk[VK_G2_1 + 2];
        pairs[11] = vk[VK_G2_1 + 3];
        return ecPairing(pairs);
    }

    /// @notice IVerifier entry point. Decodes the word blob, then verifies.
    function verify(bytes proof, uint256[] publicInputs) public override returns (bool) {
        uint256 n = proofLength();
        require(proof.length == n * 32, "PlonkVerifier: bad proof size");
        uint256[] memory words = new uint256[](n);
        uint256 i = 0;
        while (i < n) {
            uint256 acc = 0;
            uint256 j = 0;
            while (j < 32) {
                acc = acc * 256 + uint256(uint8(proof[i * 32 + j]));
                j = j + 1;
            }
            words[i] = acc;
            i = i + 1;
        }
        return verifyProof(words, publicInputs);
    }
}

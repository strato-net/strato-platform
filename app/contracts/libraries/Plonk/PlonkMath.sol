/**
 * @title PlonkMath
 * @notice BN254 scalar-field arithmetic and Fiat-Shamir transcript primitives
 *         for the PLONK verifier.
 *
 * @dev These are split out from the verifier proper because they are the parts
 *      that can be tested directly against known values. A PLONK verifier fails
 *      silently when a primitive is subtly wrong -- it simply rejects every
 *      valid proof -- so each helper here is pinned by a test rather than
 *      trusted.
 *
 * @dev SOLIDVM ENCODING TRAPS, all verified in tests/Rollup/BytesProbe.test.sol:
 *        - `bytes(uint)` is MINIMAL-length big-endian: leading zeros are
 *          stripped and zero encodes as the EMPTY string, not a zero byte.
 *          Every transcript word therefore has to be left-padded explicitly.
 *        - String literals are UTF-8 encoded, so `"\xc5"` is two bytes, not
 *          one. Never build binary constants from escapes above 0x7f.
 *        - `uint(bytes)` is big-endian, which is what the transcript needs to
 *          read a challenge out of a keccak digest.
 *        - `keccak256(bytes)` hashes exactly those bytes; the variadic
 *          `keccak256(a, b, ...)` overload RLP-encodes instead and must not be
 *          used here.
 */
library PlonkMath {
    /// @notice BN254 scalar field modulus (the order of the groups).
    uint256 internal constant R_MOD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice BN254 base field modulus (coordinates live here).
    uint256 internal constant P_MOD =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // -------------------------------------------------------------------------
    // Scalar field arithmetic
    // -------------------------------------------------------------------------

    function addFr(uint256 a, uint256 b) internal returns (uint256) {
        return addmod(a, b, R_MOD);
    }

    function subFr(uint256 a, uint256 b) internal returns (uint256) {
        return addmod(a, R_MOD - (b % R_MOD), R_MOD);
    }

    function mulFr(uint256 a, uint256 b) internal returns (uint256) {
        return mulmod(a, b, R_MOD);
    }

    /**
     * @notice Multiplicative inverse in the scalar field, via Fermat's little
     *         theorem: a^(r-2) = a^-1 (mod r).
     * @dev Reverts on zero rather than returning zero. In a verifier a zero
     *      denominator means the proof placed a challenge on a domain root --
     *      a case the protocol requires be rejected, not silently folded to
     *      zero, since 0 would satisfy equations it should not.
     */
    function invFr(uint256 a) internal returns (uint256) {
        require(a % R_MOD != 0, "PlonkMath: inverse of zero");
        return modExp(a, R_MOD - 2, R_MOD);
    }

    function divFr(uint256 a, uint256 b) internal returns (uint256) {
        return mulmod(a, invFr(b), R_MOD);
    }

    /// @notice Exponentiation in the scalar field.
    function powFr(uint256 base, uint256 e) internal returns (uint256) {
        return modExp(base, e, R_MOD);
    }

    // -------------------------------------------------------------------------
    // Transcript encoding
    // -------------------------------------------------------------------------

    /**
     * @notice Left-pad a value into a 32-byte big-endian word.
     * @dev The transcript is a concatenation of fixed-width words; without the
     *      padding, a value with a leading zero byte would shorten the buffer
     *      and shift every subsequent word, changing the digest.
     */
    function toWord(uint256 v) internal returns (bytes) {
        bytes body = bytes(v);
        bytes padded = bytes("");
        uint256 n = body.length;
        while (n < 32) {
            padded = padded + bytes("\x00");
            n = n + 1;
        }
        return padded + body;
    }

    /// @notice Append a field element / coordinate to a transcript buffer.
    function appendWord(bytes buf, uint256 v) internal returns (bytes) {
        return buf + toWord(v);
    }

    /**
     * @notice The transcript hash: SHA-256, matching gnark's precompile-0x02
     *         Fiat-Shamir. Isolated here so the choice is stated once.
     */
    function transcriptHash(bytes buf) internal returns (bytes) {
        return sha256(buf);
    }

    /**
     * @notice Read a challenge out of a digest and reduce it into the field.
     * @dev The reduction is a modular one, not a truncation: taking the low
     *      bits instead would bias the challenge distribution.
     */
    function digestToFr(bytes digest) internal returns (uint256) {
        return uint256(digest) % R_MOD;
    }

    // -------------------------------------------------------------------------
    // G1 group operations
    // -------------------------------------------------------------------------
    //
    // Thin wrappers over the SolidVM builtins. The builtins validate their
    // inputs (canonical coordinates, on-curve) and revert otherwise, so a
    // malformed proof point fails here rather than propagating into the
    // pairing check as a silently-reduced garbage point.

    /// @notice P + Q on G1. The builtin handles P == Q by doubling.
    function g1Add(uint256 px, uint256 py, uint256 qx, uint256 qy)
        internal
        returns (uint256, uint256)
    {
        return ecAdd(px, py, qx, qy);
    }

    /// @notice [s]P on G1.
    function g1Mul(uint256 px, uint256 py, uint256 s) internal returns (uint256, uint256) {
        return ecMul(px, py, s);
    }

    /**
     * @notice Accumulate `acc += [s]P`, the operation a PLONK verifier spends
     *         most of its group arithmetic on when folding commitments.
     */
    function g1MulAccumulate(
        uint256 accX,
        uint256 accY,
        uint256 px,
        uint256 py,
        uint256 s
    ) internal returns (uint256, uint256) {
        (uint256 termX, uint256 termY) = ecMul(px, py, s);
        return ecAdd(accX, accY, termX, termY);
    }

    /// @notice -P on G1. Negation is in the BASE field, not the scalar field.
    function g1Neg(uint256 px, uint256 py) internal returns (uint256, uint256) {
        if (px == 0 && py == 0) {
            return (0, 0); // the point at infinity is its own inverse
        }
        return (px, P_MOD - (py % P_MOD));
    }

    /**
     * @notice Is (x, y) a canonical point on G1 (y^2 = x^3 + 3)?
     * @dev For validating STORED points at install time. Proof points get
     *      this check for free from the builtins, which revert -- but a bad
     *      point written into storage once fails every later verify with an
     *      ecMul revert that names the proof, not the install that planted
     *      it. (0, 0) is the point at infinity and allowed.
     */
    function g1IsOnCurve(uint256 px, uint256 py) internal returns (bool) {
        if (px == 0 && py == 0) {
            return true;
        }
        if (px >= P_MOD || py >= P_MOD) {
            return false;
        }
        uint256 lhs = mulmod(py, py, P_MOD);
        uint256 rhs = addmod(mulmod(px, mulmod(px, px, P_MOD), P_MOD), 3, P_MOD);
        return lhs == rhs;
    }
}

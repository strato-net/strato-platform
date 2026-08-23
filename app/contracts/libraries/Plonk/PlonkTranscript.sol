import "../../libraries/Plonk/PlonkMath.sol";

/**
 * @title PlonkTranscript
 * @notice The Fiat-Shamir transcript for gnark's PLONK/BN254 verifier.
 *
 * @dev THE HASH IS SHA-256, NOT KECCAK. Every Fiat-Shamir hash in gnark's
 *      generated verifier calls precompile 0x02. Building this on keccak
 *      produces a verifier that compiles, passes unit tests, and rejects every
 *      valid proof.
 *
 * @dev Two rules that fail silently if broken, both encoded below:
 *
 *      1. THE ASCII PREFIX IS BARE BYTES, not a padded word. gnark stores the
 *         label in the low bytes of a word and then advances its hash pointer
 *         past the leading zeros, so the hashed stream begins with the raw 4 or
 *         5 ASCII characters.
 *
 *      2. THE RAW DIGEST IS CHAINED, not the reduced challenge. Each derivation
 *         feeds the unreduced 32-byte digest into the next transcript while
 *         keeping `digest mod r` for the arithmetic. About 81% of digests
 *         exceed the modulus, so chaining the reduced value diverges almost
 *         always -- but not on every proof, which is worse than never.
 *
 *      The one exception to rule 2 is `gammaKzg`, whose first word is the
 *      REDUCED zeta. That asymmetry is in gnark, not a mistake here.
 */
library PlonkTranscript {
    /**
     * @notice gamma: binds the verifying key, the public inputs, and the wire
     *         commitments.
     * @param vkWords Concatenated VK commitments, in the order
     *        S1 S2 S3 Ql Qr Qm Qo Qk Qcp_0.. -- permutations first, then
     *        selectors, then the Bsb22 selectors (if any).
     * @param piWords Concatenated public inputs.
     * @param lroWords Concatenated [L] [R] [O].
     * @return The raw digest (to chain) and the reduced challenge (to use).
     */
    function deriveGamma(bytes vkWords, bytes piWords, bytes lroWords)
        internal
        returns (bytes, uint256)
    {
        bytes digest = PlonkMath.transcriptHash(bytes("gamma") + vkWords + piWords + lroWords);
        return (digest, PlonkMath.digestToFr(digest));
    }

    /// @notice beta: binds nothing but the raw gamma digest.
    function deriveBeta(bytes gammaRaw) internal returns (bytes, uint256) {
        bytes digest = PlonkMath.transcriptHash(bytes("beta") + gammaRaw);
        return (digest, PlonkMath.digestToFr(digest));
    }

    /// @notice alpha: binds the raw beta digest, then the Bsb22 commitments
    ///         (if the circuit has any -- one per Committer call, raw x‖y
    ///         each, in proof order) and finally the grand-product
    ///         commitment. `zWords` is that whole [Bsb_0..Bsb_n-1, Z] run.
    function deriveAlpha(bytes betaRaw, bytes zWords) internal returns (bytes, uint256) {
        bytes digest = PlonkMath.transcriptHash(bytes("alpha") + betaRaw + zWords);
        return (digest, PlonkMath.digestToFr(digest));
    }

    /// @notice zeta: binds the raw alpha digest and the three quotient chunks.
    /// @dev The chain ends here; only the reduced value is used downstream.
    function deriveZeta(bytes alphaRaw, bytes hWords) internal returns (uint256) {
        return PlonkMath.digestToFr(
            PlonkMath.transcriptHash(bytes("zeta") + alphaRaw + hWords)
        );
    }

    /**
     * @notice gammaKzg: the challenge that folds the batch opening.
     * @dev Its first word is the REDUCED zeta -- the one place the raw-chaining
     *      rule inverts. `body` carries everything after that word.
     */
    function deriveGammaKzg(uint256 zeta, bytes body) internal returns (uint256) {
        return PlonkMath.digestToFr(
            PlonkMath.transcriptHash(bytes("gamma") + PlonkMath.toWord(zeta) + body)
        );
    }

    /**
     * @notice rho: folds the two evaluation points.
     * @dev NO ascii prefix. The hash covers exactly ten words and starts at
     *      offset zero.
     */
    function deriveRho(bytes body) internal returns (uint256) {
        return PlonkMath.digestToFr(PlonkMath.transcriptHash(body));
    }

    // -------------------------------------------------------------------------
    // Word-buffer helpers
    // -------------------------------------------------------------------------

    /// @notice Append a G1 point as two 32-byte words, (x, y).
    function appendG1(bytes buf, uint256 x, uint256 y) internal returns (bytes) {
        return buf + PlonkMath.toWord(x) + PlonkMath.toWord(y);
    }
}

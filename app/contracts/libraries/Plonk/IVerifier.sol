/**
 * @title IVerifier
 * @notice Proof-system-agnostic verification interface for the rollup.
 * @dev The rollup core never learns which proof system is in use. The public
 *      inputs are passed as field elements in a fixed order (see
 *      RollupCore._publicInputs), so swapping PLONK for another system, or
 *      rotating a verifying key after a circuit change, is a verifier
 *      redeployment plus a setVerifier call — not a rollup migration.
 *
 *      Implementations MUST revert or return false on any malformed input;
 *      returning true is a claim that the proof is valid for exactly these
 *      public inputs.
 */
interface IVerifier {
    /**
     * @param proof Opaque proof bytes, in whatever layout the implementation expects.
     * @param publicInputs Field elements, each already reduced mod the scalar field.
     * @return True if the proof is valid for these public inputs.
     */
    function verify(bytes memory proof, uint256[] memory publicInputs) external view returns (bool);

    /// @notice Identifies the proof system and circuit this verifier accepts.
    /// @dev Recorded alongside each batch so historical batches remain
    ///      interpretable after a verifier rotation.
    function verifierId() external view returns (string memory);
}

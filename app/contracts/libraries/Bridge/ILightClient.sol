/**
 * @title  ILightClient
 * @notice Minimal interface a per-source-chain light client must
 *         expose so chain-agnostic bridge-in contracts (e.g. EthBridgeIn,
 *         BaseBridgeIn) can look up verified receipts roots without
 *         knowing the underlying consensus or anchoring mechanism.
 *
 *         Concrete implementations differ wildly:
 *
 *           - {EthLightClient}   verifies sync-committee BLS sigs over
 *                                a finalized beacon header and stores
 *                                receipts roots from the execution
 *                                payload header.
 *           - {BaseLightClient}  derives finality from the L1 EthLightClient
 *                                by MPT-proving an L2OutputOracle event,
 *                                then decomposes the outputRoot to bind
 *                                a Base header.
 *           - Future BSC / Linea light clients will plug in here too.
 *
 *         All they have in common — and all the bridge-in side cares
 *         about — is "given a source-chain block number, return the
 *         verified receiptsRoot, or bytes32(0) if not yet anchored."
 *
 *         Implementations MUST guarantee that a non-zero return is
 *         consensus-final on the source chain; the bridge-in contract
 *         relies on this as the single source of trust.
 */
interface ILightClient {
    /// @notice Verified receipts root for `blockNumber` on the source
    ///         chain, or bytes32(0) if no anchor exists yet. Callers
    ///         that need to distinguish "not anchored" from "anchor is
    ///         the zero hash" (an impossible-in-practice case) can use
    ///         {isAnchored} instead.
    function getReceiptsRoot(uint256 blockNumber) external view returns (bytes32);

    /// @notice True iff `blockNumber` has a verified anchor recorded.
    function isAnchored(uint256 blockNumber) external view returns (bool);
}

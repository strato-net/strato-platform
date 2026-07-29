/**
 * @title  IBridgeMintTarget
 * @notice Interface called by EthBridgeIn after a successful claim
 *         to actually credit the recipient's balance.
 *
 *         Splitting verification (EthBridgeIn) from minting
 *         (the target) keeps each side of the bridge narrow:
 *
 *           - EthBridgeIn owns the consensus-critical surface
 *             (LightClient lookup, MPT proof, log decoding, dedup).
 *             It has no token-minting privilege.
 *
 *           - The mint target (typically MercataBridge) owns token
 *             ownership and the route allowlist. It accepts credit
 *             requests only from the configured EthBridgeIn caller.
 *
 *         The recipient gets minted tokens on STRATO; the mint target
 *         is free to apply its own policy (decimal scaling, route
 *         enabling, paused state) before accepting.
 *
 *         Implementers MUST:
 *           1. Authenticate the caller (msg.sender == configured ethBridgeIn).
 *           2. Idempotency: their own dedup keyed on `depositKey` (the
 *              same key EthBridgeIn already dedups on; double-keyed
 *              for defense-in-depth, since either side could be
 *              redeployed).
 *           3. Validate `(srcChainId, ethToken, stratoToken)` against
 *              the mint-target's own route allowlist.
 *           4. Mint `amount` of `stratoToken` to `stratoRecipient`.
 *           5. Revert on any policy failure so EthBridgeIn rolls back
 *              its own dedup write.
 */
interface IBridgeMintTarget {
    function creditTrustlessDeposit(
        bytes32 depositKey,
        uint256 srcChainId,
        address ethToken,
        address ethSender,
        address stratoRecipient,
        address stratoToken,
        uint256 amount
    ) external;
}

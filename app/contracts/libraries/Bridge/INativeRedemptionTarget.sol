/**
 * @title  INativeRedemptionTarget
 * @notice Interface called by {StratoNativeBridgeIn} after a successful
 *         redemption-claim verification to actually release the locked
 *         STRATO-native tokens to the recipient.
 *
 *         Splitting verification (StratoNativeBridgeIn) from custody
 *         release (the target — typically StratoNativeBridge) keeps each
 *         side of the bridge narrow:
 *
 *           - StratoNativeBridgeIn owns the consensus-critical surface
 *             (LightClient lookup, MPT proof, log decoding, dedup).
 *             It has no custody privilege; it can't unlock funds on its
 *             own.
 *
 *           - The redemption target (StratoNativeBridge) owns the
 *             StratoNativeCustodyVault and the asset allowlist. It
 *             accepts release requests only from the configured
 *             StratoNativeBridgeIn caller registered for the source
 *             chain.
 *
 *         The recipient gets unlocked native tokens on STRATO; the
 *         target enforces its own policy (asset enabled, representation
 *         token matches, paused state) before unlocking.
 *
 *         Implementers MUST:
 *           1. Authenticate the caller
 *              (msg.sender == nativeBridgeIns[externalChainId]).
 *           2. Maintain their own per-{depositKey} dedup (double-keyed
 *              with StratoNativeBridgeIn so either side could be
 *              redeployed without losing replay protection).
 *           3. Resolve the strato token from
 *              `stratoTokenByRepresentation[representationToken][externalChainId]`
 *              and validate the configured asset matches the proof's
 *              externalBridge + representationToken.
 *           4. Release `stratoTokenAmount` of the resolved strato token
 *              from custody to `stratoRecipient`.
 *           5. Revert on any policy failure so StratoNativeBridgeIn
 *              rolls back its own dedup write.
 *
 * @dev    Mirror of {IBridgeMintTarget} for the STRATO-native flow.
 *         Distinct interface (rather than a generalized one) because
 *         the native-redemption signature has different identity fields:
 *
 *           Standard (Eth/Base/etc. → STRATO):
 *             depositKey, srcChainId, ethToken, ethSender,
 *             stratoRecipient, stratoToken, amount
 *
 *           Native (STRATO-native unlock after external burn):
 *             depositKey, externalChainId, externalBridge,
 *             externalRedemptionId, externalSender,
 *             representationToken, stratoRecipient, stratoTokenAmount
 *
 *         The native path needs `externalBridge` (the
 *         StratoNativeRepresentationBridge address — which is the
 *         emitter of the RedemptionRequested log we MPT-verified)
 *         and `externalRedemptionId` because StratoNativeBridge keys
 *         its `deposits` mapping on the (externalChainId,
 *         externalBridge, externalRedemptionId) tuple. We pass them
 *         straight through so the trustless path can write to the same
 *         deposit storage operator-credited deposits do, keeping the
 *         UI / accounting / query layer uniform.
 */
interface INativeRedemptionTarget {
    function creditNativeRedemptionWithProof(
        bytes32 depositKey,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount
    ) external;
}

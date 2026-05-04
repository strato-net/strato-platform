/**
 * Generic transaction response
 */
export interface TransactionResponse {
    status: string;
    hash: string;
}

/**
 * Inclusion proof for a Withdrawal event emitted by MercataBridge.
 *
 * The frontend feeds these bytes into BridgeVault.claimWithdrawal on the
 * external chain. All hex strings are 0x-prefixed.
 *
 * - `headerRLP` / `signatures`: STRATO V2 block header bytes (with the
 *   commitment-seal field emptied) and the per-validator commit signatures.
 *   The on-chain STRATOLightClient.submitHeader consumes these.
 * - `receiptRLP`: canonical RLP of the receipt that contains the Withdrawal
 *   log. Compared byte-for-byte against the trie leaf during verification.
 * - `mptProof`: Merkle Patricia Trie inclusion proof: list of node-bytes
 *   from root to leaf.
 * - `blockNumber` / `txIndex` / `logIndex`: locate the event in STRATO
 *   history. Used to derive the on-chain replay nonce
 *   (keccak256(blockNumber || txIndex || logIndex)).
 */
export interface WithdrawalProof {
    blockNumber: number;
    txIndex: number;
    logIndex: number;
    headerRLP: string;
    signatures: string[];
    receiptRLP: string;
    mptProof: string[];
    /**
     * The STRATO-side event the proof targets. Tells the frontend which
     * vault method to invoke:
     *   - "Withdrawal"             → hot path; call BridgeVault.claimWithdrawal
     *                                to release funds atomically.
     *   - "WithdrawalRequestedV2"  → cold path; the withdrawal awaits admin
     *                                approval. UI typically displays a
     *                                pending-approval message; submitting
     *                                BridgeVault.submitProof is admin's job.
     */
    eventName: "Withdrawal" | "WithdrawalRequestedV2";
    /**
     * Per-chain monotonically-increasing sequence number for hot
     * Withdrawal events. The BridgeVault releases funds strictly in this
     * order. Undefined for cold-path WithdrawalRequestedV2 events
     * (admin approval gates them, not on-chain ordering).
     */
    seq?: number;
    /**
     * STRATO block of the previous hot Withdrawal event for this
     * external chain (0 if this is the first one). Lets the UI walk
     * predecessors backwards when the user's seq is ahead of the
     * vault's nextSeqToProcess and earlier proofs need catching up.
     */
    prevWithdrawalBlock?: number;
}

/**
 * Response from POST /bridge/requestWithdrawal under the proof-based flow.
 *
 * If the requestWithdrawalProof tx emitted a `Withdrawal` event (small /
 * instant tier), `proof` is populated and the frontend can immediately
 * sign+submit `BridgeVault.claimWithdrawal` on the external chain.
 *
 * For large / admin-gated withdrawals (the contract emits
 * `WithdrawalRequestedV2` instead), `proof` is still populated -- the
 * frontend submits via `BridgeVault.submitProof` instead, and waits for
 * admin approval before final release.
 */
export interface WithdrawalTransactionResponse extends TransactionResponse {
    proof?: WithdrawalProof;
}
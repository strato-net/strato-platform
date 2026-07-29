/**
 * Generic transaction response
 */
export interface TransactionResponse {
    status: string;
    hash: string;
    /**
     * Decoded return values of each transaction in the submitted batch, in
     * submission order (null for txs that produced no decoded Call result).
     */
    returnValues?: (unknown[] | null)[];
}

library BridgeTypes {
    enum BridgeStatus {
        NONE,         // default (mapping unset)
        INITIATED,    // deposit  : relayer observed external tx
                      // withdrawal: user escrowed tokens
        PENDING_REVIEW, // deposit: verification failed, needs review
                      // withdrawal: custody tx proposed, waiting for review
        COMPLETED,    // flow fully executed
        ABORTED       // user/relayer reclaimed escrow
    }

    struct DepositInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
        address externalSender;    // External chain sender
        address externalToken;     // External token deposited
        address stratoRecipient;   // STRATO recipient
        address stratoToken;       // STRATO token to mint
        uint256 stratoTokenAmount; // STRATO token amount to mint
        uint256 timestamp;         // timestamp of the deposit
    }

    struct WithdrawalInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / PENDING_REVIEW / ...
        string custodyTxHash;     // Hash of the custody transaction (set when confirmed)
        uint256 externalChainId;   // Chain where Custody resides
        address externalRecipient; // External chain recipient
        address externalToken;     // External token to receive
        uint256 requestedAt;      // timestamp of the withdrawal request (for abort accuracy)
        address stratoSender;      // STRATO sender
        address stratoToken;       // STRATO token to burn
        uint256 stratoTokenAmount; // STRATO token amount to burn
        uint256 timestamp;        // timestamp of the withdrawal
    }

    struct ChainInfo {
        address custody;            // custody on that chain
        address depositRouter;      // contract users interact with on L1/L2
        uint256 lastProcessedBlock; // last processed block on the chain for polling
        bool    enabled;            // quick toggle
        string  chainName;
    }

    struct AssetInfo {
        address externalToken;    // token address on external chain
        uint256 externalChainId;  // back-pointer to ChainInfo
        uint256 externalDecimals; // decimals of externalToken
        string  externalName;     // external token name
        string  externalSymbol;   // external token symbol
        uint256 maxPerWithdrawal; // hard ceiling for withdrawals; 0 means "unlimited"
        address stratoToken;      // STRATO token to mint (ETHst, USDST, etc)
    }
}

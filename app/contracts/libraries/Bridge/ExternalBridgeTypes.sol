library ExternalBridgeTypes {
    enum Status {
        NONE,
        INITIATED,
        PENDING_REVIEW,
        READY,
        COMPLETED,
        CANCELLED,
        REFUNDED,
        ABORTED
    }

    enum DepositAction {
        NONE,
        DEPRECATED_AUTO_SAVE_V1,
        AUTO_FORGE,
        AUTO_SAVE
    }

    struct ChainInfo {
        string chainName;
        address vault;
        address depositRouter;
        bool enabled;
        uint256 lastProcessedBlock;
    }

    struct RouteInfo {
        bool depositsEnabled;
        bool withdrawalsEnabled;
        uint256 externalChainId;
        uint256 externalDecimals;
        string externalName;
        string externalSymbol;
        address externalToken;
        address stratoToken;
        uint256 maxPerWithdrawal;
        uint256 manualReviewThreshold;
    }

    struct DepositInfo {
        Status status;
        address externalSender;
        address externalToken;
        uint256 externalTokenAmount;
        string externalTxHash;
        uint256 requestedAt;
        address stratoRecipient;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 timestamp;
    }

    struct DepositActionIntent {
        uint256 action;
        address actionToken;
        uint256 minFinalOut;
    }

    struct DepositActionConfig {
        bool autoForge;
        bool autoSave;
    }

    struct WithdrawalInfo {
        Status status;
        uint256 externalChainId;
        address externalRecipient;
        address externalToken;
        uint256 externalTokenAmount;
        uint256 requestedAt;
        address stratoSender;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 timestamp;
        uint256 authorizationDeadline;
        bool requiresManualReview;
        string reservationId;
        string reservationTxHash;
        string externalTxHash;
        string cancellationTxHash;
    }

    struct WithdrawalAuthorizationInfo {
        uint256 notBefore;
        uint256 deadline;
        uint256 signerSetVersion;
    }

    struct WithdrawalManualReview {
        string reviewDigest;
        uint256 approvalDeadline;
        string proposalHash;
    }
}

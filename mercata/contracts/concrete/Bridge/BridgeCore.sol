import "../../abstract/Bridge/BridgeEscrow.sol";
import "../../abstract/Bridge/BridgeAdmin.sol";
import "../Tokens/TokenFactory.sol";

/**
 * @title BridgeCore
 * @dev Core contract for the bridge system
 * @notice Manages deposit and withdrawal workflows
 * @notice Implements the core logic for the bridge
 */
contract record BridgeCore is BridgeEscrow, BridgeAdmin {
    /// @notice Registry of deposit transactions with replay protection
    /// @dev Maps external chain ID and transaction hash to deposit information
    /// @dev Key: (externalChainId, externalTxHash) -> Value: DepositInfo struct
    /// @dev Prevents duplicate processing of the same external transaction
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /// @notice Registry of withdrawal requests by withdrawal ID
    /// @dev Maps withdrawal ID to withdrawal information
    /// @dev Key: withdrawalId (uint256) -> Value: WithdrawalInfo struct
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    
    /// @notice Auto-incrementing counter for withdrawal IDs
    /// @dev Ensures unique withdrawal identifiers for each request
    uint256 public withdrawalCounter;

    /// @notice Emitted when a deposit is aborted by the owner
    event DepositAborted(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a deposit is completed and tokens are minted
    event DepositCompleted(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a deposit is initiated by the relayer
    event DepositInitiated(uint256 externalChainId, address externalSender, string externalTxHash, address stratoRecipient, address stratoToken, uint256 stratoTokenAmount);
    
    /// @notice Emitted when a deposit requires manual review
    event DepositPendingReview(uint256 srcChainId, string srcTxHash);
    
    /// @notice Emitted when a withdrawal is aborted and funds are refunded
    event WithdrawalAborted(uint256 withdrawalId);
    
    /// @notice Emitted when a withdrawal is completed and tokens are burned
    event WithdrawalCompleted(uint256 withdrawalId);
    
    /// @notice Emitted when a withdrawal is pending custody transaction
    event WithdrawalPending(string custodyTxHash, uint256 withdrawalId);
    
    /// @notice Emitted when a user requests a withdrawal
    event WithdrawalRequested(address dest, uint256 destChainId, uint256 externalTokenAmount, uint256 stratoTokenAmount, address token, address user, uint256 withdrawalId);

    /**
     * @dev Initializes the bridge core contract with the specified owner
     * @notice Sets up the bridge core with ownership and access control
     * @param _owner The address that will be set as the contract owner
     */
    constructor(
        address _owner
    ) BridgeAdmin(_owner) { }

    /**
     * @dev Initializes the bridge core with essential configuration
     * @notice Sets up token factory, relayer, and default values for proxied instances
     * @notice Must be called after deployment to configure the bridge properly
     * @param _tokenFactory The token factory contract address for creating STRATO tokens
     * @param _relayer The relayer address responsible for off-chain operations
     */
    function initialize(
        address _tokenFactory, address _relayer
    ) external onlyOwner {
        DECIMAL_PLACES = 18;
        USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        WITHDRAWAL_ABORT_DELAY = 172800;

        require(_tokenFactory != address(0) && _relayer != address(0), "BC: zero");
        tokenFactory = _tokenFactory;
        relayer      = _relayer;
    }

    /* ===================================================================== */
    /*                            DEPOSIT FLOW                               */
    /* ===================================================================== */

    /**
     * @dev Records a deposit transaction from an external chain
     * @notice Step-1 of the deposit flow - relayer observes external transaction
     * @notice Creates deposit record but does NOT mint tokens yet
     * @notice Allows off-chain confirmation windows and fraud checks before step-2
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalSender The address that sent the transaction on the external chain
     * @param externalToken The token address on the external chain
     * @param externalTokenAmount The amount of external tokens to deposit
     * @param externalTxHash The transaction hash on the external chain
     * @param stratoRecipient The STRATO address to receive the minted tokens
     */
    function deposit(
        uint256 externalChainId, address externalSender, address externalToken, uint256 externalTokenAmount, string externalTxHash, address stratoRecipient
    ) public onlyRelayer whenDepositsOpen {
        require(externalChainId > 0, "BC: invalid external chain id");
        require(externalSender != address(0), "BC: invalid external sender");
        require(externalTokenAmount > 0, "BC: invalid external token amount");
        require(externalTxHash.length > 0, "BC: invalid external tx hash");
        require(stratoRecipient != address(0), "BC: invalid strato recipient");
        require(chains[externalChainId].enabled, "BC: chain not enabled");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = string(uint(externalTxHash, 16), 16);
        require(deposits[externalChainId][normalizedTxHash].bridgeStatus == BridgeStatus.NONE, "BC: duplicate deposit");

        AssetInfo a = assets[externalToken][externalChainId];
        require(a.enabled, "BC: asset not enabled");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "BC: inactive token");

        // Example: 1e6 USDC * 10^(18-6) = 1e6 * 10^12 = 1e18 USDCST tokens
        uint256 stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(stratoTokenAmount > 0, "BC: invalid strato token amount");

        deposits[externalChainId][normalizedTxHash] = DepositInfo(
            BridgeStatus.INITIATED, externalSender, externalToken, block.timestamp, stratoRecipient, a.stratoToken, stratoTokenAmount, block.timestamp
        );

        emit DepositInitiated(externalChainId, externalSender, normalizedTxHash, stratoRecipient, a.stratoToken, stratoTokenAmount);
    }
    
    /**
     * @dev Records multiple deposit transactions from external chains in a single call
     * @notice Batch version of deposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual deposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalSenders Array of external sender addresses
     * @param externalTokens Array of external token addresses
     * @param externalTokenAmounts Array of external token amounts
     * @param externalTxHashes Array of external transaction hashes
     * @param stratoRecipients Array of STRATO recipient addresses
     */
    function depositBatch(
        uint256[] externalChainIds, address[] externalSenders, address[] externalTokens, uint256[] externalTokenAmounts, string[] externalTxHashes, address[] stratoRecipients
    ) external onlyRelayer whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalSenders.length && n == externalTokens.length && n == externalTokenAmounts.length && n == externalTxHashes.length && n == stratoRecipients.length, "BC: len");
        for (uint256 i = 0; i < n; i++) {
            deposit(externalChainIds[i], externalSenders[i], externalTokens[i], externalTokenAmounts[i], externalTxHashes[i], stratoRecipients[i]);
        }
    }

    /**
     * @dev Confirms a deposit and mints wrapped tokens
     * @notice Step-2.1 of the deposit flow - verification passed, mint wrapped tokens
     * @notice Only deposits in INITIATED or PENDING_REVIEW status can be confirmed
     * @notice Mints the corresponding STRATO tokens to the recipient
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function confirmDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyRelayer whenDepositsOpen {
        require(externalChainId > 0, "BC: invalid external chain id");
        require(chains[externalChainId].enabled, "BC: chain not enabled");
        require(externalTxHash.length > 0, "BC: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = string(uint(externalTxHash, 16), 16);
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "BC: bad state");

        uint256 actualMintedAmount = _mintFunds(d.stratoToken, d.stratoRecipient, d.stratoTokenAmount);
        require(actualMintedAmount > 0, "BC: no tokens minted");

        d.bridgeStatus = BridgeStatus.COMPLETED;
        d.timestamp = block.timestamp;

        emit DepositCompleted(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Confirms multiple deposits and mints wrapped tokens in a single call
     * @notice Batch version of confirmDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual confirmDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function confirmDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyRelayer whenDepositsOpen {   
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "BC: len");
        for (uint256 i = 0; i < n; i++) {
            confirmDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    /**
     * @dev Sets a deposit for manual review when verification fails
     * @notice Step-2.2 of the deposit flow - verification failed, set deposit for manual review
     * @notice Only deposits in INITIATED status can be set for review
     * @notice Owner can later abort or manually confirm reviewed deposits
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function reviewDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyRelayer whenDepositsOpen {
        require(externalChainId > 0, "BC: invalid external chain id");
        require(chains[externalChainId].enabled, "BC: chain not enabled");
        require(externalTxHash.length > 0, "BC: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = string(uint(externalTxHash, 16), 16);
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "BC: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        d.timestamp = block.timestamp;

        emit DepositPendingReview(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Sets multiple deposits for manual review when verification fails
     * @notice Batch version of reviewDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual reviewDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function reviewDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyRelayer whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "BC: len");

        for (uint256 i = 0; i < n; i++) {
            reviewDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    /**
     * @dev Aborts a deposit that was marked for manual review
     * @notice Step-2.3 of the deposit flow - cancel a deposit that was marked for review
     * @notice Only deposits in PENDING_REVIEW status can be aborted
     * @notice Only the owner can abort deposits, preventing token minting
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function abortDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "BC: invalid external chain id");
        require(chains[externalChainId].enabled, "BC: chain not enabled");
        require(externalTxHash.length > 0, "BC: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = string(uint(externalTxHash, 16), 16);
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "BC: bad state");

        d.bridgeStatus = BridgeStatus.ABORTED;
        d.timestamp = block.timestamp;

        emit DepositAborted(externalChainId, normalizedTxHash);
    }

    /**
     * @dev Aborts multiple deposits that were marked for manual review
     * @notice Batch version of abortDeposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual abortDeposit function
     * @param externalChainIds Array of external chain identifiers
     * @param externalTxHashes Array of external transaction hashes
     */
    function abortDepositBatch(
        uint256[] externalChainIds, string[] externalTxHashes
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "BC: len");

        for (uint256 i = 0; i < n; i++) {
            abortDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    /* ===================================================================== */
    /*                          WITHDRAWAL FLOW                              */
    /* ===================================================================== */

    /**
     * @dev Initiates a withdrawal request by escrowing tokens and creating a withdrawal record
     * @notice Step-1 of the withdrawal flow - user moves tokens into bridge escrow and creates request
     * @notice Returns deterministic withdrawal ID for indexers to enumerate without extra mappings
     * @notice Tokens are escrowed until the withdrawal is confirmed or aborted
     * @param externalChainId The external chain identifier where tokens should be sent
     * @param externalRecipient The address on the external chain to receive the tokens
     * @param externalToken The token address on the external chain
     * @param stratoTokenAmount The amount of STRATO tokens to withdraw
     * @return id The unique withdrawal identifier
     */
    function requestWithdrawal(
        uint256 externalChainId, address externalRecipient, address externalToken, uint256 stratoTokenAmount
    ) external whenWithdrawalsOpen returns (uint256 id) {
        require(externalChainId > 0, "BC: invalid external chain id");
        require(externalRecipient != address(0), "BC: invalid external recipient");
        require(stratoTokenAmount > 0, "BC: invalid strato token amount");
        require(chains[externalChainId].enabled, "BC: chain not enabled");

        AssetInfo a = assets[externalToken][externalChainId];
        require(a.enabled, "BC: asset not enabled");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "BC: inactive token");

        require(a.maxPerWithdrawal == 0 || stratoTokenAmount <= a.maxPerWithdrawal, "BC: per-withdrawal cap");

        uint256 actualStratoTokenAmount = _escrowFunds(a.stratoToken, msg.sender, stratoTokenAmount);
        require(actualStratoTokenAmount > 0, "BC: no tokens escrowed");

        id = ++withdrawalCounter;

        // Example: 1e18 USDCST tokens / 10^(18-6) = 1e18 / 10^12 = 1e6 USDC
        // Round down to the nearest integer
        uint256 externalTokenAmount = actualStratoTokenAmount / (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(externalTokenAmount > 0, "BC: invalid external token amount");

        withdrawals[id] = WithdrawalInfo(
            BridgeStatus.INITIATED, "", externalChainId, externalRecipient, externalToken, externalTokenAmount, block.timestamp, msg.sender, a.stratoToken, actualStratoTokenAmount, block.timestamp
        );

        emit WithdrawalRequested(externalRecipient, externalChainId, externalTokenAmount, actualStratoTokenAmount, a.stratoToken, msg.sender, id);
    }

    /**
     * @dev Confirms a withdrawal request and sets it to pending review
     * @notice Step-2 of the withdrawal flow - custody transaction has been created but not executed
     * @notice Stores the custody transaction hash so UI can show approval progress
     * @notice Only withdrawals in INITIATED status can be confirmed
     * @param id The unique withdrawal identifier
     * @param custodyTxHash The custody transaction hash on the external chain
     */
    function confirmWithdrawal(
        uint256 id, string custodyTxHash
    ) public onlyRelayer whenWithdrawalsOpen {
        require(id > 0, "BC: invalid withdrawal id");
        require(custodyTxHash.length > 0, "BC: invalid custody tx hash");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "BC: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;

        // Normalize the custody tx hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedCustodyTxHash = string(uint(custodyTxHash, 16), 16);
        w.custodyTxHash = normalizedCustodyTxHash;

        emit WithdrawalPending(normalizedCustodyTxHash, id);
    }

    /**
     * @dev Confirms multiple withdrawal requests and sets them to pending review
     * @notice Batch version of confirmWithdrawal function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each withdrawal follows the same validation rules as individual confirmWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     * @param custodyTxHashes Array of custody transaction hashes on the external chain
     */
    function confirmWithdrawalBatch(
        uint256[] ids, string[] custodyTxHashes
    ) external onlyRelayer whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0 && n == custodyTxHashes.length, "BC: len");

        for (uint256 i = 0; i < n; i++) {
            confirmWithdrawal(ids[i], custodyTxHashes[i]);
        }
    }

    /**
     * @dev Finalizes a withdrawal by burning the escrowed tokens
     * @notice Step-3 of the withdrawal flow - custody transaction executed successfully, burn escrow
     * @notice Only withdrawals in PENDING_REVIEW status can be finalized
     * @notice Burns the corresponding STRATO tokens to complete the withdrawal
     * @param id The unique withdrawal identifier
     */
    function finaliseWithdrawal(
        uint256 id
    ) public onlyRelayer whenWithdrawalsOpen {
        require(id > 0, "BC: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "BC: bad state");

        uint256 actualBurnedAmount = _burnFunds(w.stratoToken, w.stratoTokenAmount);
        require(actualBurnedAmount > 0, "BC: no tokens burned");

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;

        emit WithdrawalCompleted(id);
    }

    /**
     * @dev Finalizes multiple withdrawals by burning the escrowed tokens
     * @notice Batch version of finaliseWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual finaliseWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function finaliseWithdrawalBatch(
        uint256[] ids
    ) external onlyRelayer whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0, "BC: len");

        for (uint256 i = 0; i < n; i++) {
            finaliseWithdrawal(ids[i]);
        }
    }

    /**
     * @dev Aborts a withdrawal and refunds the escrowed tokens
     * @notice Step-4 of the withdrawal flow - abort a withdrawal and refund tokens
     * @notice Relayer can abort any withdrawal in INITIATED or PENDING_REVIEW status
     * @notice User can only abort their own withdrawal in INITIATED status after timeout
     * @notice Covers the scenario where relayer disappears before confirming
     * @notice Does not cover the scenario where custody transaction is waiting to be signed
     * @param id The unique withdrawal identifier
     */
    function abortWithdrawal(
        uint256 id
    ) public whenWithdrawalsOpen {
        require(id > 0, "BC: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        uint256 currentTimestamp = block.timestamp;

        if (msg.sender == relayer) {
            require(w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "BC: not abortable");
        }
        else {
            require(msg.sender == w.stratoSender, "BC: not sender");
            require(w.bridgeStatus == BridgeStatus.INITIATED, "BC: not abortable");
            require(currentTimestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY, "BC: wait 48h");
        }

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = currentTimestamp;

        uint256 actualRefundedAmount = _refundFunds(w.stratoToken, w.stratoSender, w.stratoTokenAmount);
        require(actualRefundedAmount > 0, "BC: no tokens refunded");

        emit WithdrawalAborted(id);
    }

    /**
     * @dev Aborts multiple withdrawals and refunds the escrowed tokens
     * @notice Batch version of abortWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual abortWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function abortWithdrawalBatch(
        uint256[] ids
    ) external whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0, "BC: len");

        for (uint256 i = 0; i < n; i++) {
            abortWithdrawal(ids[i]);
        }
    }
}
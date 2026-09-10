import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../Admin/AdminRegistry.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "./StratoNativeCustodyVault.sol";

/**
 * @title StratoNativeBridge
 * @notice Separate bridge lifecycle for STRATO-native assets.
 * @notice Keeps native lock/unlock liabilities isolated from the existing MercataBridge flow.
 */
contract record StratoNativeBridge is Ownable {
    using BridgeTypes for *;
    using StringUtils for string;

    struct NativeAssetConfig {
        bool enabled;
        uint256 externalChainId;
        address externalBridge;
        address representationToken;
        string externalName;
        string externalSymbol;
        uint256 maxPerWithdrawal;
        uint256 instantWithdrawalThreshold;
        address stratoToken;
    }

    struct NativeTokenBridgeConfig {
        bool depositsDisabled;
        bool withdrawalsDisabled;
        uint256 maxOutstandingWithdrawal;
    }

    struct NativeDepositInfo {
        BridgeStatus bridgeStatus;
        string depositId;
        address externalBridge;
        address externalSender;
        string externalTxHash;
        uint256 externalChainId;
        uint256 externalRedemptionId;
        address representationToken;
        uint256 requestedAt;
        address stratoRecipient;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 timestamp;
    }

    struct NativeWithdrawalInfo {
        BridgeStatus bridgeStatus;
        string externalTxHash;
        uint256 externalChainId;
        address externalBridge;
        address externalRecipient;
        address representationToken;
        uint256 externalTokenAmount;
        uint256 requestedAt;
        address stratoSender;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 timestamp;
        string nativeMintProposalHash;
        uint256 nativeMintNotBefore;
        bool useInstantPath;
    }

    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    event TokenFactoryUpdated(address indexed newFactory, address indexed oldFactory);
    event CustodyVaultUpdated(address indexed newVault, address indexed oldVault);
    event NativeBridgeOperatorUpdated(address indexed previousBridgeOperator, address indexed newBridgeOperator);
    event NativeBridgeGuardianUpdated(address indexed previousGuardian, address indexed newGuardian);
    event NativeTokenBridgeConfigUpdated(
        address indexed stratoToken,
        bool depositsDisabled,
        bool withdrawalsDisabled,
        uint256 maxOutstandingWithdrawal
    );
    event NativeAssetUpdated(
        bool enabled,
        uint256 externalChainId,
        address externalBridge,
        address representationToken,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        uint256 instantWithdrawalThreshold,
        address stratoToken
    );
    event NativeDepositInitiated(
        string depositId,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event NativeDepositPendingReview(
        string depositId,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    );
    event NativeDepositCompleted(
        string depositId,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event NativeDepositAborted(
        string depositId,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    );
    event NativeWithdrawalRequested(
        uint256 indexed withdrawalId,
        uint256 externalChainId,
        address externalBridge,
        address externalRecipient,
        address representationToken,
        address stratoSender,
        address stratoToken,
        uint256 stratoTokenAmount,
        bool useInstantPath
    );
    event NativeWithdrawalPending(uint256 indexed withdrawalId, string externalTxHash);
    event NativeWithdrawalProposalRecorded(uint256 indexed withdrawalId, string nativeMintProposalHash);
    event NativeWithdrawalCompleted(uint256 indexed withdrawalId, string externalTxHash, string nativeMintProposalHash);
    event NativeWithdrawalAborted(uint256 indexed withdrawalId);
    event InstantWithdrawalDelayUpdated(uint256 previousDelaySeconds, uint256 newDelaySeconds);

    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;
    uint256 public INSTANT_WITHDRAWAL_DELAY_SECONDS = 900;
    bool public depositsPaused;
    bool public withdrawalsPaused;
    uint256 public withdrawalCounter;

    address public tokenFactory;
    address public custodyVault;
    address public bridgeOperator;
    address public guardian;

    mapping(address => mapping(uint256 => NativeAssetConfig)) public record assets;
    mapping(address => mapping(uint256 => address)) public record stratoTokenByRepresentation;
    mapping(string => NativeDepositInfo) public record deposits;
    mapping(uint256 => NativeWithdrawalInfo) public record withdrawals;
    mapping(address => NativeTokenBridgeConfig) public record tokenBridgeConfigs;

    modifier whenDepositsOpen() {
        require(!depositsPaused, "SNB: deposits paused");
        _;
    }

    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "SNB: withdrawals paused");
        _;
    }

    modifier onlyBridgeOperator() {
        require(msg.sender == owner() || msg.sender == bridgeOperator, "SNB: not bridge operator");
        _;
    }

    modifier onlyGuardian() {
        require(msg.sender == owner() || msg.sender == guardian, "SNB: not guardian");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(
        address _tokenFactory,
        address _custodyVault,
        address _bridgeOperator,
        address _guardian
    ) external onlyOwner {
        WITHDRAWAL_ABORT_DELAY = 172800;
        INSTANT_WITHDRAWAL_DELAY_SECONDS = 900;
        require(_bridgeOperator != address(0), "SNB: zero operator");
        require(_guardian != address(0), "SNB: zero guardian");

        _setBridgeOperator(_bridgeOperator);
        _setGuardian(_guardian);
        _setTokenFactory(_tokenFactory);
        _setCustodyVault(_custodyVault);
    }

    function setBridgeOperator(address newBridgeOperator) external onlyOwner {
        _setBridgeOperator(newBridgeOperator);
    }

    function _setBridgeOperator(address newBridgeOperator) internal {
        require(newBridgeOperator != address(0), "SNB: zero operator");
        emit NativeBridgeOperatorUpdated(bridgeOperator, newBridgeOperator);
        bridgeOperator = newBridgeOperator;
    }

    function setGuardian(address newGuardian) external onlyOwner {
        _setGuardian(newGuardian);
    }

    function _setGuardian(address newGuardian) internal {
        require(newGuardian != address(0), "SNB: zero guardian");
        emit NativeBridgeGuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setInstantWithdrawalDelaySeconds(uint256 newDelaySeconds) external onlyOwner {
        uint256 previousDelaySeconds = INSTANT_WITHDRAWAL_DELAY_SECONDS;
        INSTANT_WITHDRAWAL_DELAY_SECONDS = newDelaySeconds;
        emit InstantWithdrawalDelayUpdated(previousDelaySeconds, newDelaySeconds);
    }

    function setTokenBridgeConfig(
        address stratoToken,
        bool depositsDisabled,
        bool withdrawalsDisabled,
        uint256 maxOutstandingWithdrawal
    ) external onlyOwner {
        require(stratoToken != address(0), "SNB: invalid strato token");

        tokenBridgeConfigs[stratoToken] = NativeTokenBridgeConfig(
            depositsDisabled,
            withdrawalsDisabled,
            maxOutstandingWithdrawal
        );

        emit NativeTokenBridgeConfigUpdated(
            stratoToken,
            depositsDisabled,
            withdrawalsDisabled,
            maxOutstandingWithdrawal
        );
    }

    function setPause(bool _depositsPaused, bool _withdrawalsPaused) external {
        bool isUnpausingDeposits = depositsPaused && !_depositsPaused;
        bool isUnpausingWithdrawals = withdrawalsPaused && !_withdrawalsPaused;

        if (isUnpausingDeposits || isUnpausingWithdrawals) {
            require(msg.sender == owner(), "SNB: only owner unpauses");
        } else {
            require(
                msg.sender == owner() || msg.sender == guardian,
                "SNB: not guardian"
            );
        }

        depositsPaused = _depositsPaused;
        withdrawalsPaused = _withdrawalsPaused;
        emit PauseToggled(_depositsPaused, _withdrawalsPaused);
    }

    function setTokenFactory(address newFactory) public onlyOwner {
        _setTokenFactory(newFactory);
    }

    function _setTokenFactory(address newFactory) internal {
        require(newFactory != address(0), "SNB: zero factory");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    function setCustodyVault(address newVault) public onlyOwner {
        _setCustodyVault(newVault);
    }

    function _setCustodyVault(address newVault) internal {
        require(newVault != address(0), "SNB: zero vault");
        emit CustodyVaultUpdated(newVault, custodyVault);
        custodyVault = newVault;
    }

    function getDepositId(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    ) public returns (string) {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(externalBridge != address(0), "SNB: invalid external bridge");
        require(externalRedemptionId > 0, "SNB: invalid redemption id");
        return keccak256(externalChainId, externalBridge, externalRedemptionId);
    }

    function getWithdrawalInfo(
        uint256 id
    ) public returns (
        BridgeStatus bridgeStatus,
        string externalTxHash,
        uint256 externalChainId,
        address externalBridge,
        address externalRecipient,
        address representationToken,
        uint256 externalTokenAmount,
        address stratoSender,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 nativeMintNotBefore,
        bool useInstantPath
    ) {
        NativeWithdrawalInfo w = withdrawals[id];
        return (
            w.bridgeStatus,
            w.externalTxHash,
            w.externalChainId,
            w.externalBridge,
            w.externalRecipient,
            w.representationToken,
            w.externalTokenAmount,
            w.stratoSender,
            w.stratoToken,
            w.stratoTokenAmount,
            w.nativeMintNotBefore,
            w.useInstantPath
        );
    }

    function getDepositInfo(
        string depositId
    ) public returns (
        BridgeStatus bridgeStatus,
        string storedDepositId,
        address externalBridge,
        address externalSender,
        string externalTxHash,
        uint256 externalChainId,
        uint256 externalRedemptionId,
        address representationToken,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    ) {
        NativeDepositInfo d = deposits[depositId];
        return (
            d.bridgeStatus,
            d.depositId,
            d.externalBridge,
            d.externalSender,
            d.externalTxHash,
            d.externalChainId,
            d.externalRedemptionId,
            d.representationToken,
            d.stratoRecipient,
            d.stratoToken,
            d.stratoTokenAmount
        );
    }

    function getAssetConfig(
        address stratoToken,
        uint256 externalChainId
    ) public returns (
        bool enabled,
        address externalBridge,
        address representationToken,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        uint256 instantWithdrawalThreshold
    ) {
        NativeAssetConfig asset = assets[stratoToken][externalChainId];
        return (
            asset.enabled,
            asset.externalBridge,
            asset.representationToken,
            asset.externalName,
            asset.externalSymbol,
            asset.maxPerWithdrawal,
            asset.instantWithdrawalThreshold
        );
    }

    function setAsset(
        bool enabled,
        uint256 externalChainId,
        address externalBridge,
        address representationToken,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        uint256 instantWithdrawalThreshold,
        address stratoToken
    ) external onlyOwner {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(externalBridge != address(0), "SNB: invalid external bridge");
        require(representationToken != address(0), "SNB: invalid representation token");
        require(bytes(externalName).length > 0, "SNB: invalid external name");
        require(bytes(externalSymbol).length > 0, "SNB: invalid external symbol");
        require(stratoToken != address(0), "SNB: invalid strato token");

        assets[stratoToken][externalChainId] = NativeAssetConfig(
            enabled,
            externalChainId,
            externalBridge,
            representationToken,
            externalName,
            externalSymbol,
            maxPerWithdrawal,
            instantWithdrawalThreshold,
            stratoToken
        );
        stratoTokenByRepresentation[representationToken][externalChainId] = stratoToken;

        emit NativeAssetUpdated(
            enabled,
            externalChainId,
            externalBridge,
            representationToken,
            externalName,
            externalSymbol,
            maxPerWithdrawal,
            instantWithdrawalThreshold,
            stratoToken
        );
    }

    function _requireActiveFactoryToken(address stratoToken) internal view {
        if (TokenFactory(tokenFactory).isFactoryToken(stratoToken)) {
            require(Token(stratoToken).status() == TokenStatus.ACTIVE, "SNB: inactive token");
        }
    }

    function requestWithdrawal(
        uint256 externalChainId,
        address externalRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    ) external whenWithdrawalsOpen returns (uint256 id) {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(externalRecipient != address(0), "SNB: invalid external recipient");
        require(stratoToken != address(0), "SNB: invalid strato token");
        require(stratoTokenAmount > 0, "SNB: invalid strato token amount");
        require(custodyVault != address(0), "SNB: vault not set");

        NativeAssetConfig asset = assets[stratoToken][externalChainId];
        require(asset.stratoToken != address(0), "SNB: asset missing");
        require(asset.enabled, "SNB: asset disabled");
        NativeTokenBridgeConfig tokenConfig = tokenBridgeConfigs[stratoToken];
        require(!tokenConfig.withdrawalsDisabled, "SNB: token withdrawals disabled");
        require(
            asset.maxPerWithdrawal == 0 || stratoTokenAmount <= asset.maxPerWithdrawal,
            "SNB: per-withdrawal cap"
        );
        _requireActiveFactoryToken(stratoToken);
        require(
            tokenConfig.maxOutstandingWithdrawal == 0
                || StratoNativeCustodyVault(custodyVault).lockedBalance(stratoToken) + stratoTokenAmount
                    <= tokenConfig.maxOutstandingWithdrawal,
            "SNB: aggregate withdrawal cap"
        );

        uint256 actualLockedAmount = StratoNativeCustodyVault(custodyVault).lock(
            stratoToken,
            msg.sender,
            stratoTokenAmount
        );
        require(actualLockedAmount > 0, "SNB: no tokens locked");

        bool useInstantPath = asset.instantWithdrawalThreshold > 0
            && actualLockedAmount <= asset.instantWithdrawalThreshold;

        id = ++withdrawalCounter;
        withdrawals[id] = NativeWithdrawalInfo(
            BridgeStatus.INITIATED,
            "",
            externalChainId,
            asset.externalBridge,
            externalRecipient,
            asset.representationToken,
            actualLockedAmount,
            block.timestamp,
            msg.sender,
            stratoToken,
            actualLockedAmount,
            block.timestamp,
            "",
            0,
            useInstantPath
        );

        emit NativeWithdrawalRequested(
            id,
            externalChainId,
            asset.externalBridge,
            externalRecipient,
            asset.representationToken,
            msg.sender,
            stratoToken,
            actualLockedAmount,
            useInstantPath
        );
    }

    function markWithdrawalPending(uint256 id) public onlyBridgeOperator whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");

        NativeWithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "SNB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;
        w.nativeMintNotBefore = block.timestamp + INSTANT_WITHDRAWAL_DELAY_SECONDS;

        emit NativeWithdrawalPending(id, w.externalTxHash);
    }

    function recordWithdrawalProposal(uint256 id, string nativeMintProposalHash) public onlyBridgeOperator whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");
        require(bytes(nativeMintProposalHash).length > 0, "SNB: invalid proposal hash");

        NativeWithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "SNB: bad state");
        require(bytes(w.externalTxHash).length == 0, "SNB: tx hash already set");
        require(bytes(w.nativeMintProposalHash).length == 0, "SNB: proposal already set");

        w.nativeMintProposalHash = nativeMintProposalHash.normalizeHex();
        w.timestamp = block.timestamp;

        emit NativeWithdrawalProposalRecorded(id, w.nativeMintProposalHash);
    }

    function finalizeWithdrawal(
        uint256 id,
        string externalTxHash,
        string nativeMintProposalHash
    ) public onlyBridgeOperator whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");
        require(bytes(externalTxHash).length > 0, "SNB: invalid external tx hash");

        NativeWithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "SNB: bad state");
        require(bytes(w.externalTxHash).length == 0, "SNB: tx hash already set");

        string normalizedExternalTxHash = externalTxHash.normalizeHex();
        w.externalTxHash = normalizedExternalTxHash;

        if (bytes(nativeMintProposalHash).length > 0) {
            string normalizedProposalHash = nativeMintProposalHash.normalizeHex();
            if (bytes(w.nativeMintProposalHash).length > 0) {
                require(w.nativeMintProposalHash == normalizedProposalHash, "SNB: proposal mismatch");
            } else {
                w.nativeMintProposalHash = normalizedProposalHash;
                emit NativeWithdrawalProposalRecorded(id, w.nativeMintProposalHash);
            }
        }

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;

        emit NativeWithdrawalCompleted(id, w.externalTxHash, w.nativeMintProposalHash);
    }

    function abortWithdrawal(uint256 id) public whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");
        require(custodyVault != address(0), "SNB: vault not set");

        NativeWithdrawalInfo w = withdrawals[id];
        uint256 currentTimestamp = block.timestamp;

        AdminRegistry admin = AdminRegistry(owner());
        if (admin.whitelist(address(this), "abortWithdrawal", msg.sender)) {
            require(
                w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW,
                "SNB: not abortable"
            );
        } else {
            require(msg.sender == w.stratoSender, "SNB: not sender");
            require(w.bridgeStatus == BridgeStatus.INITIATED, "SNB: not abortable");
            require(currentTimestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY, "SNB: wait 48h");
        }
        require(bytes(w.externalTxHash).length == 0, "SNB: external tx set");

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = currentTimestamp;

        uint256 actualUnlockedAmount = StratoNativeCustodyVault(custodyVault).unlock(
            w.stratoToken,
            w.stratoSender,
            w.stratoTokenAmount
        );
        require(actualUnlockedAmount > 0, "SNB: no tokens unlocked");

        emit NativeWithdrawalAborted(id);
    }

    function recordDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount
    ) external onlyBridgeOperator whenDepositsOpen {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(externalBridge != address(0), "SNB: invalid external bridge");
        require(externalRedemptionId > 0, "SNB: invalid redemption id");
        require(externalSender != address(0), "SNB: invalid external sender");
        require(bytes(externalTxHash).length > 0, "SNB: invalid external tx hash");
        require(representationToken != address(0), "SNB: invalid representation token");
        require(stratoRecipient != address(0), "SNB: invalid strato recipient");
        require(stratoTokenAmount > 0, "SNB: invalid strato token amount");

        string depositId = getDepositId(
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
        string normalizedTxHash = externalTxHash.normalizeHex();
        NativeDepositInfo existingDeposit = deposits[depositId];
        require(existingDeposit.bridgeStatus == BridgeStatus.NONE, "SNB: duplicate deposit");

        address stratoToken = stratoTokenByRepresentation[representationToken][externalChainId];
        require(stratoToken != address(0), "SNB: asset missing");

        NativeAssetConfig asset = assets[stratoToken][externalChainId];
        require(asset.enabled, "SNB: asset disabled");
        require(!tokenBridgeConfigs[stratoToken].depositsDisabled, "SNB: token deposits disabled");
        require(asset.externalBridge == externalBridge, "SNB: wrong external bridge");
        require(asset.representationToken == representationToken, "SNB: wrong representation token");

        deposits[depositId] = NativeDepositInfo(
            BridgeStatus.INITIATED,
            depositId,
            externalBridge,
            externalSender,
            normalizedTxHash,
            externalChainId,
            externalRedemptionId,
            representationToken,
            block.timestamp,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        emit NativeDepositInitiated(
            depositId,
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            normalizedTxHash,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount
        );
    }

    function reviewDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    ) external onlyBridgeOperator whenDepositsOpen {
        string depositId = getDepositId(
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
        NativeDepositInfo d = deposits[depositId];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "SNB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        d.timestamp = block.timestamp;

        emit NativeDepositPendingReview(
            depositId,
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
    }

    function confirmDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    ) external onlyBridgeOperator whenDepositsOpen {
        require(custodyVault != address(0), "SNB: vault not set");

        string depositId = getDepositId(
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
        NativeDepositInfo d = deposits[depositId];
        require(
            d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: bad state"
        );

        uint256 actualUnlockedAmount = StratoNativeCustodyVault(custodyVault).unlock(
            d.stratoToken,
            d.stratoRecipient,
            d.stratoTokenAmount
        );
        require(actualUnlockedAmount > 0, "SNB: no tokens unlocked");

        d.bridgeStatus = BridgeStatus.COMPLETED;
        d.timestamp = block.timestamp;

        emit NativeDepositCompleted(
            depositId,
            externalChainId,
            externalBridge,
            externalRedemptionId,
            d.externalSender,
            d.externalTxHash,
            d.stratoRecipient,
            d.stratoToken,
            actualUnlockedAmount
        );
    }

    function abortDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId
    ) external onlyBridgeOperator whenDepositsOpen {
        string depositId = getDepositId(
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
        NativeDepositInfo d = deposits[depositId];
        require(
            d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: bad state"
        );

        d.bridgeStatus = BridgeStatus.ABORTED;
        d.timestamp = block.timestamp;

        emit NativeDepositAborted(
            depositId,
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
    }
}

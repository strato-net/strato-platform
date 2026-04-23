import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../Admin/AdminRegistry.sol";
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
        address representationToken;
        string externalName;
        string externalSymbol;
        uint256 maxPerWithdrawal;
        address stratoToken;
    }

    struct NativeDepositInfo {
        BridgeStatus bridgeStatus;
        address externalSender;
        string externalTxHash;
        uint256 externalChainId;
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
        address externalRecipient;
        address representationToken;
        uint256 externalTokenAmount;
        uint256 requestedAt;
        address stratoSender;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 timestamp;
    }

    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    event TokenFactoryUpdated(address indexed newFactory, address indexed oldFactory);
    event CustodyVaultUpdated(address indexed newVault, address indexed oldVault);
    event NativeAssetUpdated(
        bool enabled,
        uint256 externalChainId,
        address representationToken,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        address stratoToken
    );
    event NativeDepositInitiated(
        uint256 externalChainId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event NativeDepositPendingReview(uint256 externalChainId, string externalTxHash);
    event NativeDepositCompleted(
        uint256 externalChainId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event NativeDepositAborted(uint256 externalChainId, string externalTxHash);
    event NativeWithdrawalRequested(
        uint256 indexed withdrawalId,
        uint256 externalChainId,
        address externalRecipient,
        address representationToken,
        address stratoSender,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event NativeWithdrawalPending(uint256 indexed withdrawalId, string externalTxHash);
    event NativeWithdrawalCompleted(uint256 indexed withdrawalId);
    event NativeWithdrawalAborted(uint256 indexed withdrawalId);

    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;
    bool public depositsPaused;
    bool public withdrawalsPaused;
    uint256 public withdrawalCounter;

    address public tokenFactory;
    address public custodyVault;

    mapping(address => mapping(uint256 => NativeAssetConfig)) public record assets;
    mapping(address => mapping(uint256 => address)) public record stratoTokenByRepresentation;
    mapping(uint256 => mapping(string => NativeDepositInfo)) public record deposits;
    mapping(uint256 => NativeWithdrawalInfo) public record withdrawals;

    modifier whenDepositsOpen() {
        require(!depositsPaused, "SNB: deposits paused");
        _;
    }

    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "SNB: withdrawals paused");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _tokenFactory, address _custodyVault) external onlyOwner {
        WITHDRAWAL_ABORT_DELAY = 172800;
        setTokenFactory(_tokenFactory);
        setCustodyVault(_custodyVault);
    }

    function setPause(bool _depositsPaused, bool _withdrawalsPaused) external onlyOwner {
        depositsPaused = _depositsPaused;
        withdrawalsPaused = _withdrawalsPaused;
        emit PauseToggled(_depositsPaused, _withdrawalsPaused);
    }

    function setTokenFactory(address newFactory) public onlyOwner {
        require(newFactory != address(0), "SNB: zero factory");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    function setCustodyVault(address newVault) public onlyOwner {
        require(newVault != address(0), "SNB: zero vault");
        emit CustodyVaultUpdated(newVault, custodyVault);
        custodyVault = newVault;
    }

    function setAsset(
        bool enabled,
        uint256 externalChainId,
        address representationToken,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        address stratoToken
    ) external onlyOwner {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(representationToken != address(0), "SNB: invalid representation token");
        require(bytes(externalName).length > 0, "SNB: invalid external name");
        require(bytes(externalSymbol).length > 0, "SNB: invalid external symbol");
        require(stratoToken != address(0), "SNB: invalid strato token");

        assets[stratoToken][externalChainId] = NativeAssetConfig(
            enabled,
            externalChainId,
            representationToken,
            externalName,
            externalSymbol,
            maxPerWithdrawal,
            stratoToken
        );
        stratoTokenByRepresentation[representationToken][externalChainId] = stratoToken;

        emit NativeAssetUpdated(
            enabled,
            externalChainId,
            representationToken,
            externalName,
            externalSymbol,
            maxPerWithdrawal,
            stratoToken
        );
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
        require(
            asset.maxPerWithdrawal == 0 || stratoTokenAmount <= asset.maxPerWithdrawal,
            "SNB: per-withdrawal cap"
        );
        require(TokenFactory(tokenFactory).isTokenActive(stratoToken), "SNB: inactive token");

        uint256 actualLockedAmount = StratoNativeCustodyVault(custodyVault).lock(
            stratoToken,
            msg.sender,
            stratoTokenAmount
        );
        require(actualLockedAmount > 0, "SNB: no tokens locked");

        id = ++withdrawalCounter;
        withdrawals[id] = NativeWithdrawalInfo(
            BridgeStatus.INITIATED,
            "",
            externalChainId,
            externalRecipient,
            asset.representationToken,
            actualLockedAmount,
            block.timestamp,
            msg.sender,
            stratoToken,
            actualLockedAmount,
            block.timestamp
        );

        emit NativeWithdrawalRequested(
            id,
            externalChainId,
            externalRecipient,
            asset.representationToken,
            msg.sender,
            stratoToken,
            actualLockedAmount
        );
    }

    function confirmWithdrawal(uint256 id, string externalTxHash) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");
        require(bytes(externalTxHash).length > 0, "SNB: invalid external tx hash");

        NativeWithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "SNB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.externalTxHash = externalTxHash.normalizeHex();
        w.timestamp = block.timestamp;

        emit NativeWithdrawalPending(id, w.externalTxHash);
    }

    function finaliseWithdrawal(uint256 id) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "SNB: invalid withdrawal id");

        NativeWithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "SNB: bad state");

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;

        emit NativeWithdrawalCompleted(id);
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
        address externalSender,
        string externalTxHash,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount
    ) external onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "SNB: invalid external chain id");
        require(externalSender != address(0), "SNB: invalid external sender");
        require(bytes(externalTxHash).length > 0, "SNB: invalid external tx hash");
        require(representationToken != address(0), "SNB: invalid representation token");
        require(stratoRecipient != address(0), "SNB: invalid strato recipient");
        require(stratoTokenAmount > 0, "SNB: invalid strato token amount");

        string normalizedTxHash = externalTxHash.normalizeHex();
        NativeDepositInfo existingDeposit = deposits[externalChainId][normalizedTxHash];
        require(existingDeposit.bridgeStatus == BridgeStatus.NONE, "SNB: duplicate deposit");

        address stratoToken = stratoTokenByRepresentation[representationToken][externalChainId];
        require(stratoToken != address(0), "SNB: asset missing");

        NativeAssetConfig asset = assets[stratoToken][externalChainId];
        require(asset.enabled, "SNB: asset disabled");

        deposits[externalChainId][normalizedTxHash] = NativeDepositInfo(
            BridgeStatus.INITIATED,
            externalSender,
            normalizedTxHash,
            externalChainId,
            representationToken,
            block.timestamp,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        emit NativeDepositInitiated(
            externalChainId,
            externalSender,
            normalizedTxHash,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount
        );
    }

    function reviewDeposit(uint256 externalChainId, string externalTxHash) external onlyOwner whenDepositsOpen {
        string normalizedTxHash = externalTxHash.normalizeHex();
        NativeDepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "SNB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        d.timestamp = block.timestamp;

        emit NativeDepositPendingReview(externalChainId, normalizedTxHash);
    }

    function confirmDeposit(uint256 externalChainId, string externalTxHash) external onlyOwner whenDepositsOpen {
        require(custodyVault != address(0), "SNB: vault not set");

        string normalizedTxHash = externalTxHash.normalizeHex();
        NativeDepositInfo d = deposits[externalChainId][normalizedTxHash];
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
            externalChainId,
            d.externalSender,
            normalizedTxHash,
            d.stratoRecipient,
            d.stratoToken,
            actualUnlockedAmount
        );
    }

    function abortDeposit(uint256 externalChainId, string externalTxHash) external onlyOwner whenDepositsOpen {
        string normalizedTxHash = externalTxHash.normalizeHex();
        NativeDepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(
            d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: bad state"
        );

        d.bridgeStatus = BridgeStatus.ABORTED;
        d.timestamp = block.timestamp;

        emit NativeDepositAborted(externalChainId, normalizedTxHash);
    }
}

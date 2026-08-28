import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../libraries/Bridge/ExternalBridgeTypes.sol";
import "../Metals/MetalForge.sol";
import "../Pools/DirectMintPSM.sol";
import "../Savings/SaveUSDSTVault.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";

/**
 * @title ExternalAssetBridge
 * @notice STRATO coordinator for externally canonical assets held in ExternalBridgeVault contracts.
 */
contract record ExternalAssetBridge is Ownable {
    using ExternalBridgeTypes for *;
    using StringUtils for string;

    event Initialized(
        address tokenFactory,
        address bridgeOperator,
        address guardian,
        address usdst
    );
    event BridgeOperatorUpdated(address previousOperator, address newOperator);
    event GuardianUpdated(address previousGuardian, address newGuardian);
    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    event ChainUpdated(
        string chainName,
        address vault,
        address depositRouter,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock
    );
    event LastProcessedBlockUpdated(
        uint256 externalChainId,
        uint256 lastProcessedBlock
    );
    event RouteUpdated(
        address externalToken,
        uint256 externalChainId,
        address stratoToken,
        bool depositsEnabled,
        bool withdrawalsEnabled,
        uint256 externalDecimals,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        uint256 manualReviewThreshold
    );
    event DepositActionAvailabilityUpdated(
        address externalToken,
        uint256 externalChainId,
        address targetStratoToken,
        uint256 action,
        bool enabled
    );
    event DepositInitiated(
        uint256 externalChainId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event DepositIdentity(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string externalTxHash
    );
    event DepositPendingReview(
        uint256 externalChainId,
        string externalTxHash
    );
    event DepositCompleted(
        uint256 externalChainId,
        address externalSender,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event DepositAborted(uint256 externalChainId, string externalTxHash);
    event AutoSavedUSDST(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string externalTxHash,
        address recipient,
        address sourceToken,
        uint256 sourceAmount,
        uint256 usdstAmount,
        address saveToken,
        uint256 shares
    );
    event AutoForgedViaPSM(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string externalTxHash,
        address recipient,
        address sourceToken,
        uint256 sourceAmount,
        uint256 usdstAmount,
        address metalToken,
        uint256 metalAmount
    );
    event DepositActionFallback(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string externalTxHash,
        address recipient,
        uint256 action,
        address actionToken,
        address fallbackToken,
        uint256 fallbackAmount
    );
    event WithdrawalRequested(
        uint256 withdrawalId,
        uint256 externalChainId,
        address externalRecipient,
        address externalToken,
        uint256 externalTokenAmount,
        address stratoSender,
        address stratoToken,
        uint256 stratoTokenAmount,
        bool requiresManualReview
    );
    event WithdrawalReady(
        uint256 withdrawalId,
        uint256 authorizationNotBefore,
        uint256 authorizationDeadline,
        uint256 signerSetVersion
    );
    event WithdrawalReviewRequested(
        uint256 withdrawalId,
        string reviewDigest,
        uint256 approvalDeadline,
        string proposalHash
    );
    event WithdrawalReviewExpired(uint256 withdrawalId);
    event WithdrawalReviewRejected(uint256 withdrawalId);
    event WithdrawalReservationRecorded(
        uint256 withdrawalId,
        string reservationId,
        string reservationTxHash
    );
    event WithdrawalCompleted(
        uint256 withdrawalId,
        string reservationId,
        string externalTxHash,
        address stratoSender,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event WithdrawalCancellationRecorded(
        uint256 withdrawalId,
        string reservationId,
        string cancellationTxHash
    );
    event WithdrawalRefunded(uint256 withdrawalId);
    event WithdrawalAborted(uint256 withdrawalId);
    event TokenFactoryUpdated(address newFactory, address oldFactory);
    event USDSTAddressUpdated(address newAddress, address oldAddress);
    event DirectMintPsmUpdated(address newPsm, address oldPsm);
    event SaveUsdstVaultUpdated(address newVault, address oldVault);
    event MetalForgeUpdated(address newForge, address oldForge);
    event WithdrawalAbortDelayUpdated(
        uint256 previousDelay,
        uint256 newDelay
    );
    event AuthorizationValidityUpdated(
        uint256 previousValidity,
        uint256 newValidity
    );
    event DepositRouterUpdated(
        uint256 externalChainId,
        address depositRouter,
        bool enabled
    );

    uint256 public DECIMAL_PLACES = 18;
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;
    uint256 public MAX_AUTHORIZATION_VALIDITY_SECONDS = 1800;

    bool public initialized;
    bool public depositsPaused;
    bool public withdrawalsPaused;

    address public tokenFactory;
    address public bridgeOperator;
    address public guardian;
    address public USDST_ADDRESS;
    address public directMintPsm;
    address public saveUsdstVault;
    address public metalForge;

    uint256 public withdrawalCounter;

    mapping(uint256 => ChainInfo) public record chains;
    mapping(uint256 => mapping(address => bool)) public record depositRouters;
    mapping(address => mapping(uint256 => mapping(address => RouteInfo))) public record routes;
    mapping(uint256 => mapping(address => mapping(uint256 => DepositInfo))) public record deposits;
    mapping(uint256 => mapping(address => mapping(uint256 => DepositActionIntent))) public record depositActions;
    mapping(address => mapping(uint256 => mapping(address => DepositActionConfig))) public record depositActionConfigs;
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    mapping(uint256 => WithdrawalAuthorizationInfo) public record withdrawalAuthorizations;
    mapping(uint256 => WithdrawalManualReview) public record withdrawalManualReviews;
    mapping(string => uint256) public withdrawalByReservationId;
    mapping(string => uint256) public withdrawalByExternalTxHash;

    modifier onlyBridgeOperator() {
        require(
            msg.sender == owner() || msg.sender == bridgeOperator,
            "EAB: not bridge operator"
        );
        _;
    }

    modifier whenDepositsOpen() {
        require(!depositsPaused, "EAB: deposits paused");
        _;
    }

    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "EAB: withdrawals paused");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(
        address newTokenFactory,
        address newBridgeOperator,
        address newGuardian,
        address newUSDSTAddress
    ) external onlyOwner {
        require(!initialized, "EAB: already initialized");
        require(newTokenFactory != address(0), "EAB: zero factory");
        require(newBridgeOperator != address(0), "EAB: zero operator");
        require(newGuardian != address(0), "EAB: zero guardian");
        require(newUSDSTAddress != address(0), "EAB: zero USDST");

        initialized = true;
        DECIMAL_PLACES = 18;
        WITHDRAWAL_ABORT_DELAY = 172800;
        MAX_AUTHORIZATION_VALIDITY_SECONDS = 1800;
        tokenFactory = newTokenFactory;
        bridgeOperator = newBridgeOperator;
        guardian = newGuardian;
        USDST_ADDRESS = newUSDSTAddress;

        emit Initialized(
            newTokenFactory,
            newBridgeOperator,
            newGuardian,
            newUSDSTAddress
        );
    }

    function setBridgeOperator(
        address newBridgeOperator
    ) external onlyOwner {
        require(newBridgeOperator != address(0), "EAB: zero operator");
        emit BridgeOperatorUpdated(bridgeOperator, newBridgeOperator);
        bridgeOperator = newBridgeOperator;
    }

    function setGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "EAB: zero guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setPause(
        bool newDepositsPaused,
        bool newWithdrawalsPaused
    ) external {
        bool unpausing =
            (depositsPaused && !newDepositsPaused) ||
            (withdrawalsPaused && !newWithdrawalsPaused);
        if (unpausing) {
            require(msg.sender == owner(), "EAB: only owner unpauses");
        } else {
            require(
                msg.sender == owner() || msg.sender == guardian,
                "EAB: not guardian"
            );
        }
        depositsPaused = newDepositsPaused;
        withdrawalsPaused = newWithdrawalsPaused;
        emit PauseToggled(newDepositsPaused, newWithdrawalsPaused);
    }

    function setChain(
        string chainName,
        address vault,
        address depositRouter,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock
    ) external onlyOwner {
        require(chainName.length > 0, "EAB: invalid chain name");
        require(vault != address(0), "EAB: zero vault");
        require(depositRouter != address(0), "EAB: zero router");
        require(externalChainId > 0, "EAB: invalid chain id");

        chains[externalChainId] = ChainInfo(
            chainName,
            vault,
            depositRouter,
            enabled,
            lastProcessedBlock
        );
        depositRouters[externalChainId][depositRouter] = true;
        emit ChainUpdated(
            chainName,
            vault,
            depositRouter,
            enabled,
            externalChainId,
            lastProcessedBlock
        );
        emit DepositRouterUpdated(
            externalChainId,
            depositRouter,
            true
        );
    }

    function setDepositRouterEnabled(
        uint256 externalChainId,
        address depositRouter,
        bool enabled
    ) external onlyOwner {
        require(
            chains[externalChainId].vault != address(0),
            "EAB: chain missing"
        );
        require(depositRouter != address(0), "EAB: zero router");
        depositRouters[externalChainId][depositRouter] = enabled;
        emit DepositRouterUpdated(
            externalChainId,
            depositRouter,
            enabled
        );
    }

    function setLastProcessedBlock(
        uint256 externalChainId,
        uint256 lastProcessedBlock
    ) external onlyBridgeOperator {
        ChainInfo chain = chains[externalChainId];
        require(chain.vault != address(0), "EAB: chain missing");
        require(
            lastProcessedBlock >= chain.lastProcessedBlock,
            "EAB: block rollback"
        );
        chain.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(
            externalChainId,
            lastProcessedBlock
        );
    }

    function setRoute(
        address externalToken,
        uint256 externalChainId,
        address stratoToken,
        bool depositsEnabled,
        bool withdrawalsEnabled,
        uint256 externalDecimals,
        string externalName,
        string externalSymbol,
        uint256 maxPerWithdrawal,
        uint256 manualReviewThreshold
    ) external onlyOwner {
        require(
            chains[externalChainId].vault != address(0),
            "EAB: chain missing"
        );
        require(stratoToken != address(0), "EAB: zero strato token");
        require(externalDecimals <= DECIMAL_PLACES, "EAB: decimals exceed max");
        require(externalName.length > 0, "EAB: invalid external name");
        require(externalSymbol.length > 0, "EAB: invalid external symbol");
        if (depositsEnabled || withdrawalsEnabled) {
            require(
                TokenFactory(tokenFactory).isTokenActive(stratoToken),
                "EAB: inactive token"
            );
        }

        routes[externalToken][externalChainId][
            stratoToken
        ] = RouteInfo(
            depositsEnabled,
            withdrawalsEnabled,
            externalChainId,
            externalDecimals,
            externalName,
            externalSymbol,
            externalToken,
            stratoToken,
            maxPerWithdrawal,
            manualReviewThreshold
        );

        emit RouteUpdated(
            externalToken,
            externalChainId,
            stratoToken,
            depositsEnabled,
            withdrawalsEnabled,
            externalDecimals,
            externalName,
            externalSymbol,
            maxPerWithdrawal,
            manualReviewThreshold
        );
    }

    function setDepositAction(
        address externalToken,
        uint256 externalChainId,
        address stratoToken,
        uint256 action,
        bool enabled
    ) external onlyOwner {
        require(
            action == uint256(DepositAction.AUTO_FORGE) ||
                action ==
                uint256(DepositAction.AUTO_SAVE),
            "EAB: invalid action"
        );
        RouteInfo route = routes[externalToken][
            externalChainId
        ][stratoToken];
        require(route.stratoToken != address(0), "EAB: route missing");
        if (enabled) {
            require(route.depositsEnabled, "EAB: deposits disabled");
        }

        DepositActionConfig config = depositActionConfigs[
            externalToken
        ][externalChainId][stratoToken];
        if (
            action == uint256(DepositAction.AUTO_FORGE)
        ) {
            config.autoForge = enabled;
        } else {
            config.autoSave = enabled;
        }
        emit DepositActionAvailabilityUpdated(
            externalToken,
            externalChainId,
            stratoToken,
            action,
            enabled
        );
    }

    function setTokenFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "EAB: zero factory");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    function setUSDSTAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "EAB: zero USDST");
        emit USDSTAddressUpdated(newAddress, USDST_ADDRESS);
        USDST_ADDRESS = newAddress;
    }

    function setDirectMintPsm(address newPsm) external onlyOwner {
        require(newPsm != address(0), "EAB: zero PSM");
        require(
            DirectMintPSM(newPsm).mintableToken() == USDST_ADDRESS,
            "EAB: PSM token mismatch"
        );
        emit DirectMintPsmUpdated(newPsm, directMintPsm);
        directMintPsm = newPsm;
    }

    function setSaveUsdstVault(address newVault) external onlyOwner {
        require(newVault != address(0), "EAB: zero save vault");
        require(
            SaveUSDSTVault(newVault).asset() == USDST_ADDRESS,
            "EAB: save asset mismatch"
        );
        emit SaveUsdstVaultUpdated(newVault, saveUsdstVault);
        saveUsdstVault = newVault;
    }

    function setMetalForge(address newForge) external onlyOwner {
        require(newForge != address(0), "EAB: zero forge");
        emit MetalForgeUpdated(newForge, metalForge);
        metalForge = newForge;
    }

    function setWithdrawalAbortDelay(
        uint256 newDelay
    ) external onlyOwner {
        emit WithdrawalAbortDelayUpdated(WITHDRAWAL_ABORT_DELAY, newDelay);
        WITHDRAWAL_ABORT_DELAY = newDelay;
    }

    function setMaxAuthorizationValiditySeconds(
        uint256 newValidity
    ) external onlyOwner {
        require(newValidity > 0, "EAB: zero validity");
        emit AuthorizationValidityUpdated(
            MAX_AUTHORIZATION_VALIDITY_SECONDS,
            newValidity
        );
        MAX_AUTHORIZATION_VALIDITY_SECONDS = newValidity;
    }

    function settleDeposit(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 action,
        address actionToken,
        uint256 minFinalOut
    ) external onlyBridgeOperator whenDepositsOpen {
        _recordDeposit(
            externalChainId,
            depositRouter,
            depositId,
            externalSender,
            externalToken,
            externalTokenAmount,
            externalTxHash,
            stratoRecipient,
            stratoToken,
            action,
            actionToken,
            minFinalOut
        );
        _confirmDeposit(
            externalChainId,
            depositRouter,
            depositId
        );
    }

    function recordDepositForReview(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 action,
        address actionToken,
        uint256 minFinalOut
    ) external onlyBridgeOperator whenDepositsOpen {
        _recordDeposit(
            externalChainId,
            depositRouter,
            depositId,
            externalSender,
            externalToken,
            externalTokenAmount,
            externalTxHash,
            stratoRecipient,
            stratoToken,
            action,
            actionToken,
            minFinalOut
        );
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        depositInfo.status = Status.PENDING_REVIEW;
        depositInfo.timestamp = block.timestamp;
        emit DepositPendingReview(
            externalChainId,
            depositInfo.externalTxHash
        );
    }

    function confirmReviewedDeposit(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) external onlyBridgeOperator whenDepositsOpen {
        _confirmDeposit(
            externalChainId,
            depositRouter,
            depositId
        );
    }

    function _confirmDeposit(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) internal {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        require(
            depositInfo.status == Status.INITIATED ||
                depositInfo.status ==
                Status.PENDING_REVIEW,
            "EAB: bad state"
        );

        DepositActionIntent intent = depositActions[
            externalChainId
        ][depositRouter][depositId];
        bool executable =
            (
                intent.action ==
                    uint256(DepositAction.AUTO_FORGE) ||
                intent.action ==
                    uint256(DepositAction.AUTO_SAVE)
            ) &&
            _isDepositActionEnabled(
                depositInfo,
                externalChainId,
                intent.action
            );

        if (executable) {
            try {
                _executeDepositAction(
                    externalChainId,
                    depositRouter,
                    depositId
                );
            } catch {
                _mintDepositFallback(
                    depositInfo,
                    externalChainId,
                    depositRouter,
                    depositId,
                    depositInfo.externalTxHash,
                    intent
                );
            }
        } else if (
            intent.action !=
            uint256(DepositAction.NONE)
        ) {
            _mintDepositFallback(
                depositInfo,
                externalChainId,
                depositRouter,
                depositId,
                depositInfo.externalTxHash,
                intent
            );
        } else {
            _mintFunds(
                depositInfo.stratoToken,
                depositInfo.stratoRecipient,
                depositInfo.stratoTokenAmount
            );
        }

        _deleteDepositAction(
            externalChainId,
            depositRouter,
            depositId
        );
        depositInfo.status = Status.COMPLETED;
        depositInfo.timestamp = block.timestamp;
        emit DepositCompleted(
            externalChainId,
            depositInfo.externalSender,
            depositInfo.externalTxHash,
            depositInfo.stratoRecipient,
            depositInfo.stratoToken,
            depositInfo.stratoTokenAmount
        );
    }

    function abortDeposit(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) external onlyOwner {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        require(
            depositInfo.status ==
                Status.PENDING_REVIEW,
            "EAB: bad state"
        );
        depositInfo.status = Status.ABORTED;
        depositInfo.timestamp = block.timestamp;
        _deleteDepositAction(
            externalChainId,
            depositRouter,
            depositId
        );
        emit DepositAborted(
            externalChainId,
            depositInfo.externalTxHash
        );
    }

    function requestWithdrawal(
        uint256 externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint256 stratoTokenAmount
    ) external whenWithdrawalsOpen returns (uint256 withdrawalId) {
        require(externalRecipient != address(0), "EAB: zero recipient");
        require(stratoTokenAmount > 0, "EAB: zero amount");
        require(chains[externalChainId].enabled, "EAB: chain disabled");

        RouteInfo route = routes[externalToken][
            externalChainId
        ][stratoToken];
        require(route.withdrawalsEnabled, "EAB: withdrawals disabled");
        require(
            TokenFactory(tokenFactory).isTokenActive(stratoToken),
            "EAB: inactive token"
        );

        uint256 scale = 10 ** (DECIMAL_PLACES - route.externalDecimals);
        uint256 externalTokenAmount = stratoTokenAmount / scale;
        require(externalTokenAmount > 0, "EAB: amount too small");
        if (route.maxPerWithdrawal != 0) {
            require(
                externalTokenAmount <= route.maxPerWithdrawal,
                "EAB: withdrawal cap"
            );
        }

        stratoTokenAmount = externalTokenAmount * scale;
        stratoTokenAmount = _escrowFunds(
            stratoToken,
            msg.sender,
            stratoTokenAmount
        );
        externalTokenAmount = stratoTokenAmount / scale;
        require(externalTokenAmount > 0, "EAB: invalid external amount");

        bool requiresManualReview =
            route.manualReviewThreshold != 0 &&
            externalTokenAmount > route.manualReviewThreshold;
        withdrawalId = ++withdrawalCounter;
        withdrawals[withdrawalId] = WithdrawalInfo(
            Status.INITIATED,
            externalChainId,
            externalRecipient,
            externalToken,
            externalTokenAmount,
            block.timestamp,
            msg.sender,
            stratoToken,
            stratoTokenAmount,
            block.timestamp,
            0,
            requiresManualReview,
            "",
            "",
            "",
            ""
        );

        emit WithdrawalRequested(
            withdrawalId,
            externalChainId,
            externalRecipient,
            externalToken,
            externalTokenAmount,
            msg.sender,
            stratoToken,
            stratoTokenAmount,
            requiresManualReview
        );
    }

    function markWithdrawalReady(
        uint256 withdrawalId,
        uint256 authorizationNotBefore,
        uint256 authorizationDeadline,
        uint256 signerSetVersion
    ) public onlyBridgeOperator whenWithdrawalsOpen {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        WithdrawalManualReview review = withdrawalManualReviews[withdrawalId];
        require(
            (!withdrawal.requiresManualReview &&
                withdrawal.status == Status.INITIATED) ||
                (withdrawal.requiresManualReview &&
                    withdrawal.status == Status.PENDING_REVIEW &&
                    review.approvalDeadline >= authorizationDeadline),
            "EAB: bad state"
        );
        require(
            authorizationDeadline > block.timestamp &&
                authorizationDeadline >= authorizationNotBefore &&
                authorizationDeadline <=
                authorizationNotBefore +
                    MAX_AUTHORIZATION_VALIDITY_SECONDS,
            "EAB: invalid deadline"
        );
        require(signerSetVersion > 0, "EAB: invalid signer set");

        withdrawal.status = Status.READY;
        withdrawal.authorizationDeadline = authorizationDeadline;
        WithdrawalAuthorizationInfo authorization = withdrawalAuthorizations[
            withdrawalId
        ];
        authorization.notBefore = authorizationNotBefore;
        authorization.deadline = authorizationDeadline;
        authorization.signerSetVersion = signerSetVersion;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalReady(
            withdrawalId,
            authorizationNotBefore,
            authorizationDeadline,
            signerSetVersion
        );
    }

    function recordWithdrawalReview(
        uint256 withdrawalId,
        string reviewDigest,
        uint256 approvalDeadline,
        string proposalHash
    ) external onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[withdrawalId];
        require(
            withdrawal.status == Status.INITIATED &&
                withdrawal.requiresManualReview,
            "EAB: bad state"
        );
        require(
            reviewDigest.length > 0 &&
                proposalHash.length > 0 &&
                approvalDeadline > block.timestamp,
            "EAB: invalid review"
        );

        string normalizedDigest = reviewDigest.normalizeHex();
        string normalizedProposalHash = proposalHash.normalizeHex();
        WithdrawalManualReview review = withdrawalManualReviews[withdrawalId];
        review.reviewDigest = normalizedDigest;
        review.approvalDeadline = approvalDeadline;
        review.proposalHash = normalizedProposalHash;
        withdrawal.status = Status.PENDING_REVIEW;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalReviewRequested(
            withdrawalId,
            normalizedDigest,
            approvalDeadline,
            normalizedProposalHash
        );
    }

    function expireWithdrawalReview(
        uint256 withdrawalId
    ) external onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[withdrawalId];
        WithdrawalManualReview review = withdrawalManualReviews[withdrawalId];
        require(
            withdrawal.status == Status.PENDING_REVIEW &&
                block.timestamp > review.approvalDeadline,
            "EAB: review active"
        );
        delete withdrawalManualReviews[withdrawalId];
        withdrawal.status = Status.INITIATED;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalReviewExpired(withdrawalId);
    }

    function rejectWithdrawalReview(
        uint256 withdrawalId
    ) external onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[withdrawalId];
        require(
            withdrawal.status == Status.PENDING_REVIEW &&
                withdrawal.requiresManualReview,
            "EAB: bad state"
        );
        _refundFunds(
            withdrawal.stratoToken,
            withdrawal.stratoSender,
            withdrawal.stratoTokenAmount
        );
        delete withdrawalManualReviews[withdrawalId];
        withdrawal.status = Status.ABORTED;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalReviewRejected(withdrawalId);
    }

    function recordWithdrawalReservation(
        uint256 withdrawalId,
        string reservationId,
        string reservationTxHash
    ) external onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        require(
            withdrawal.status == Status.READY,
            "EAB: bad state"
        );
        require(
            withdrawal.reservationId.length == 0,
            "EAB: reservation recorded"
        );
        require(
            reservationId.length > 0 && reservationTxHash.length > 0,
            "EAB: invalid reservation"
        );

        string normalizedReservationId = reservationId.normalizeHex();
        require(
            withdrawalByReservationId[normalizedReservationId] == 0,
            "EAB: duplicate reservation"
        );
        withdrawal.reservationId = normalizedReservationId;
        withdrawal.reservationTxHash = reservationTxHash.normalizeHex();
        withdrawal.timestamp = block.timestamp;
        withdrawalByReservationId[normalizedReservationId] = withdrawalId;

        emit WithdrawalReservationRecorded(
            withdrawalId,
            normalizedReservationId,
            withdrawal.reservationTxHash
        );
    }

    function finalizeWithdrawal(
        uint256 withdrawalId,
        string reservationId,
        string externalTxHash
    ) public onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        require(
            withdrawal.status == Status.READY,
            "EAB: bad state"
        );
        require(externalTxHash.length > 0, "EAB: invalid external tx");

        string normalizedReservationId = reservationId.normalizeHex();
        require(
            withdrawal.reservationId == normalizedReservationId,
            "EAB: reservation mismatch"
        );
        string normalizedExternalTxHash = externalTxHash.normalizeHex();
        require(
            withdrawalByExternalTxHash[normalizedExternalTxHash] == 0,
            "EAB: duplicate external tx"
        );

        _burnFunds(withdrawal.stratoToken, withdrawal.stratoTokenAmount);
        withdrawal.status = Status.COMPLETED;
        withdrawal.externalTxHash = normalizedExternalTxHash;
        withdrawal.timestamp = block.timestamp;
        withdrawalByExternalTxHash[
            normalizedExternalTxHash
        ] = withdrawalId;

        emit WithdrawalCompleted(
            withdrawalId,
            normalizedReservationId,
            normalizedExternalTxHash,
            withdrawal.stratoSender,
            withdrawal.stratoToken,
            withdrawal.stratoTokenAmount
        );
    }

    function recordWithdrawalCancellation(
        uint256 withdrawalId,
        string reservationId,
        string cancellationTxHash
    ) external onlyBridgeOperator {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        require(
            withdrawal.status == Status.READY,
            "EAB: bad state"
        );
        require(
            block.timestamp > withdrawal.authorizationDeadline,
            "EAB: authorization active"
        );
        require(cancellationTxHash.length > 0, "EAB: invalid cancellation");

        string normalizedReservationId = reservationId.normalizeHex();
        require(
            withdrawal.reservationId == normalizedReservationId,
            "EAB: reservation mismatch"
        );
        withdrawal.status = Status.CANCELLED;
        withdrawal.cancellationTxHash = cancellationTxHash.normalizeHex();
        withdrawal.timestamp = block.timestamp;

        emit WithdrawalCancellationRecorded(
            withdrawalId,
            normalizedReservationId,
            withdrawal.cancellationTxHash
        );
    }

    function refundWithdrawal(uint256 withdrawalId) external onlyOwner {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        bool cancelled =
            withdrawal.status == Status.CANCELLED;
        bool readyWithoutReservation =
            withdrawal.status == Status.READY &&
            withdrawal.reservationId.length == 0 &&
            block.timestamp > withdrawal.authorizationDeadline;
        require(
            cancelled || readyWithoutReservation,
            "EAB: not refundable"
        );

        _refundFunds(
            withdrawal.stratoToken,
            withdrawal.stratoSender,
            withdrawal.stratoTokenAmount
        );
        withdrawal.status = Status.REFUNDED;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalRefunded(withdrawalId);
    }

    function abortWithdrawal(uint256 withdrawalId) public {
        WithdrawalInfo withdrawal = withdrawals[
            withdrawalId
        ];
        require(
            withdrawal.status == Status.INITIATED,
            "EAB: not abortable"
        );

        if (
            msg.sender != owner() && msg.sender != bridgeOperator
        ) {
            require(
                msg.sender == withdrawal.stratoSender,
                "EAB: not sender"
            );
            require(
                block.timestamp >=
                    withdrawal.requestedAt + WITHDRAWAL_ABORT_DELAY,
                "EAB: wait 48h"
            );
        }

        _refundFunds(
            withdrawal.stratoToken,
            withdrawal.stratoSender,
            withdrawal.stratoTokenAmount
        );
        withdrawal.status = Status.ABORTED;
        withdrawal.timestamp = block.timestamp;
        emit WithdrawalAborted(withdrawalId);
    }

    function _recordDeposit(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 action,
        address actionToken,
        uint256 minFinalOut
    ) internal {
        require(depositRouter != address(0), "EAB: zero router");
        require(depositId > 0, "EAB: zero deposit id");
        require(externalSender != address(0), "EAB: zero sender");
        require(externalTokenAmount > 0, "EAB: zero amount");
        require(externalTxHash.length > 0, "EAB: empty tx hash");
        require(stratoRecipient != address(0), "EAB: zero recipient");
        require(chains[externalChainId].enabled, "EAB: chain disabled");
        require(
            depositRouters[externalChainId][depositRouter],
            "EAB: unknown router"
        );

        RouteInfo route = routes[externalToken][
            externalChainId
        ][stratoToken];
        require(route.depositsEnabled, "EAB: deposits disabled");
        require(
            TokenFactory(tokenFactory).isTokenActive(stratoToken),
            "EAB: inactive token"
        );

        string normalizedTxHash = externalTxHash.normalizeHex();
        Status existingStatus = deposits[externalChainId][
            depositRouter
        ][depositId].status;
        require(
            existingStatus == Status.NONE ||
                existingStatus == Status.ABORTED,
            "EAB: duplicate deposit"
        );

        uint256 stratoTokenAmount =
            externalTokenAmount *
            (10 ** (DECIMAL_PLACES - route.externalDecimals));
        require(stratoTokenAmount > 0, "EAB: invalid amount");

        DepositInfo depositInfo = deposits[externalChainId][
            depositRouter
        ][depositId];
        depositInfo.status = Status.INITIATED;
        depositInfo.externalSender = externalSender;
        depositInfo.externalToken = externalToken;
        depositInfo.externalTokenAmount = externalTokenAmount;
        depositInfo.externalTxHash = normalizedTxHash;
        depositInfo.requestedAt = block.timestamp;
        depositInfo.stratoRecipient = stratoRecipient;
        depositInfo.stratoToken = stratoToken;
        depositInfo.stratoTokenAmount = stratoTokenAmount;
        depositInfo.timestamp = block.timestamp;
        if (action != uint256(DepositAction.NONE)) {
            depositActions[externalChainId][depositRouter][
                depositId
            ] = DepositActionIntent(
                action,
                actionToken,
                minFinalOut
            );
        }
        emit DepositInitiated(
            externalChainId,
            externalSender,
            normalizedTxHash,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount
        );
        emit DepositIdentity(
            externalChainId,
            depositRouter,
            depositId,
            normalizedTxHash
        );
    }

    function _executeDepositAction(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) internal {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        DepositActionIntent intent = depositActions[
            externalChainId
        ][depositRouter][depositId];
        string normalizedTxHash = depositInfo.externalTxHash;

        uint256 sourceAmount = _mintFunds(
            depositInfo.stratoToken,
            address(this),
            depositInfo.stratoTokenAmount
        );
        uint256 usdstOut;
        if (depositInfo.stratoToken == USDST_ADDRESS) {
            usdstOut = sourceAmount;
        } else {
            require(directMintPsm != address(0), "EAB: PSM not set");
            IERC20(depositInfo.stratoToken).approve(
                directMintPsm,
                sourceAmount
            );
            uint256 beforeBalance = IERC20(USDST_ADDRESS).balanceOf(
                address(this)
            );
            DirectMintPSM(directMintPsm).mint(
                sourceAmount,
                depositInfo.stratoToken
            );
            usdstOut =
                IERC20(USDST_ADDRESS).balanceOf(address(this)) -
                beforeBalance;
            require(usdstOut > 0, "EAB: no USDST minted");
        }

        if (
            intent.action ==
            uint256(DepositAction.AUTO_SAVE)
        ) {
            require(saveUsdstVault != address(0), "EAB: save vault not set");
            IERC20(USDST_ADDRESS).approve(saveUsdstVault, usdstOut);
            uint256 beforeShares = IERC20(saveUsdstVault).balanceOf(
                depositInfo.stratoRecipient
            );
            uint256 shares = SaveUSDSTVault(saveUsdstVault).deposit(
                usdstOut,
                depositInfo.stratoRecipient
            );
            uint256 actualShares =
                IERC20(saveUsdstVault).balanceOf(
                    depositInfo.stratoRecipient
                ) -
                beforeShares;
            require(
                actualShares > 0 && actualShares == shares,
                "EAB: autosave failed"
            );
            emit AutoSavedUSDST(
                externalChainId,
                depositRouter,
                depositId,
                normalizedTxHash,
                depositInfo.stratoRecipient,
                depositInfo.stratoToken,
                sourceAmount,
                usdstOut,
                saveUsdstVault,
                actualShares
            );
        } else {
            require(
                intent.action ==
                    uint256(
                        DepositAction.AUTO_FORGE
                    ),
                "EAB: invalid action"
            );
            require(metalForge != address(0), "EAB: forge not set");
            require(intent.actionToken != address(0), "EAB: zero metal");
            IERC20(USDST_ADDRESS).approve(metalForge, usdstOut);
            uint256 beforeMetal = IERC20(intent.actionToken).balanceOf(
                address(this)
            );
            MetalForge(metalForge).mintMetal(
                intent.actionToken,
                USDST_ADDRESS,
                usdstOut,
                intent.minFinalOut
            );
            uint256 metalOut =
                IERC20(intent.actionToken).balanceOf(address(this)) -
                beforeMetal;
            require(metalOut > 0, "EAB: no metal minted");
            require(
                IERC20(intent.actionToken).transfer(
                    depositInfo.stratoRecipient,
                    metalOut
                ),
                "EAB: metal transfer failed"
            );
            emit AutoForgedViaPSM(
                externalChainId,
                depositRouter,
                depositId,
                normalizedTxHash,
                depositInfo.stratoRecipient,
                depositInfo.stratoToken,
                sourceAmount,
                usdstOut,
                intent.actionToken,
                metalOut
            );
        }
    }

    function _mintDepositFallback(
        DepositInfo depositInfo,
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string normalizedTxHash,
        DepositActionIntent intent
    ) internal {
        uint256 amount = _mintFunds(
            depositInfo.stratoToken,
            depositInfo.stratoRecipient,
            depositInfo.stratoTokenAmount
        );
        emit DepositActionFallback(
            externalChainId,
            depositRouter,
            depositId,
            normalizedTxHash,
            depositInfo.stratoRecipient,
            intent.action,
            intent.actionToken,
            depositInfo.stratoToken,
            amount
        );
    }

    function _isDepositActionEnabled(
        DepositInfo depositInfo,
        uint256 externalChainId,
        uint256 action
    ) internal returns (bool) {
        DepositActionConfig config = depositActionConfigs[
            depositInfo.externalToken
        ][externalChainId][depositInfo.stratoToken];
        if (
            action ==
            uint256(DepositAction.AUTO_FORGE)
        ) {
            return config.autoForge;
        }
        if (
            action ==
            uint256(DepositAction.AUTO_SAVE)
        ) {
            return config.autoSave;
        }
        return false;
    }

    function _deleteDepositAction(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) internal {
        delete depositActions[externalChainId][depositRouter][depositId].action;
        delete depositActions[externalChainId][depositRouter][depositId].actionToken;
        delete depositActions[externalChainId][depositRouter][depositId].minFinalOut;
    }

    function _escrowFunds(
        address token,
        address from,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(
            IERC20(token).transferFrom(from, address(this), amount),
            "EAB: transfer failed"
        );
        actualAmount =
            IERC20(token).balanceOf(address(this)) -
            balanceBefore;
        require(actualAmount > 0, "EAB: no tokens received");
    }

    function _mintFunds(
        address token,
        address to,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        Token(token).mint(to, amount);
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "EAB: no tokens minted");
    }

    function _burnFunds(
        address token,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        Token(token).burn(address(this), amount);
        actualAmount =
            balanceBefore -
            IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "EAB: no tokens burned");
    }

    function _refundFunds(
        address token,
        address to,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transfer(to, amount), "EAB: refund failed");
        actualAmount =
            balanceBefore -
            IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "EAB: no tokens refunded");
    }
}

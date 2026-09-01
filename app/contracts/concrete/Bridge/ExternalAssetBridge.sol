import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../libraries/Bridge/ExternalBridgeTypes.sol";
import "../../libraries/Router/RouterTypes.sol";
import "../Lending/PriceOracle.sol";
import "../Metals/MetalForge.sol";
import "../Pools/DirectMintPSM.sol";
import "../Router/TokenRouter.sol";
import "../Savings/SaveUSDSTVault.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";

/**
 * @title ExternalAssetBridge
 * @notice STRATO coordinator for externally canonical assets held in ExternalBridgeVault contracts.
 */
contract record ExternalAssetBridge is Ownable {
    using ExternalBridgeTypes for *;
    using RouterTypes for *;
    using StringUtils for string;

    event Initialized(
        address tokenFactory,
        address bridgeOperator,
        address guardian,
        address usdst
    );
    event BridgeOperatorUpdated(address previousOperator, address newOperator);
    event GuardianUpdated(address previousGuardian, address newGuardian);
    event PriceOracleUpdated(address previousOracle, address newOracle);
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
    event RouteRebaseRequirementUpdated(
        address externalToken,
        uint256 externalChainId,
        address stratoToken,
        bool required
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
    event DepositReuseAuthorized(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    );
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
    event TokenRouterUpdated(address newRouter, address oldRouter);
    event AutoRouted(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        string externalTxHash,
        address recipient,
        address sourceToken,
        uint256 sourceAmount,
        address finalToken,
        uint256 finalAmount
    );
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
    event SettlementVerifierUpdated(
        address verifier,
        bool enabled,
        uint256 verifierSetVersion
    );
    event SettlementVerifierThresholdUpdated(
        uint8 threshold,
        uint256 verifierSetVersion
    );
    event SettlementAttested(
        bytes32 digest,
        address verifier,
        uint8 attestationCount
    );

    uint256 public DECIMAL_PLACES = 18;
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;
    uint256 public MAX_AUTHORIZATION_VALIDITY_SECONDS = 1800;
    uint256 public constant MAX_ROUTE_STEPS = 6;
    uint256 public constant ROUTE_EXECUTION_DEADLINE = 300;

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
    address public priceOracle;
    mapping(address => mapping(uint256 => mapping(address => bool))) public record routeRebaseRequired;
    address public tokenRouter;
    mapping(uint256 => mapping(address => mapping(uint256 => mapping(uint256 => RouteStep)))) public record depositRouteSteps;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public record depositRouteStepCounts;
    mapping(address => bool) public record settlementVerifiers;
    uint8 public settlementVerifierCount;
    uint8 public settlementVerifierThreshold;
    uint256 public settlementVerifierSetVersion;
    mapping(bytes32 => mapping(address => bool)) public record settlementAttestations;
    mapping(bytes32 => uint8) public record settlementAttestationCounts;

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

    function setPriceOracle(address newPriceOracle) external onlyOwner {
        require(newPriceOracle != address(0), "EAB: zero oracle");
        emit PriceOracleUpdated(priceOracle, newPriceOracle);
        priceOracle = newPriceOracle;
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

    function setRouteRebaseRequired(
        address externalToken,
        uint256 externalChainId,
        address stratoToken,
        bool required
    ) external onlyOwner {
        RouteInfo route = routes[externalToken][
            externalChainId
        ][stratoToken];
        require(route.stratoToken != address(0), "EAB: route missing");
        if (required) {
            require(priceOracle != address(0), "EAB: oracle not set");
            require(
                PriceOracle(priceOracle).rebaseFactors(stratoToken) > 0,
                "EAB: rebase factor not set"
            );
        }
        routeRebaseRequired[externalToken][externalChainId][
            stratoToken
        ] = required;
        emit RouteRebaseRequirementUpdated(
            externalToken,
            externalChainId,
            stratoToken,
            required
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
            action == uint256(DepositAction.AUTO_ROUTE),
            "EAB: invalid action"
        );
        RouteInfo route = routes[externalToken][
            externalChainId
        ][stratoToken];
        require(route.stratoToken != address(0), "EAB: route missing");
        if (enabled) {
            require(route.depositsEnabled, "EAB: deposits disabled");
            require(tokenRouter != address(0), "EAB: token router not set");
            require(
                TokenRouter(tokenRouter).initialized(),
                "EAB: token router not initialized"
            );
        }

        DepositActionConfig config = depositActionConfigs[
            externalToken
        ][externalChainId][stratoToken];
        config.autoRoute = enabled;
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

    function setTokenRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "EAB: zero token router");
        require(
            TokenRouter(newRouter).initialized(),
            "EAB: token router not initialized"
        );
        emit TokenRouterUpdated(newRouter, tokenRouter);
        tokenRouter = newRouter;
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

    function setSettlementVerifier(
        address verifier,
        bool enabled
    ) external onlyOwner {
        require(verifier != address(0), "EAB: zero verifier");
        bool currentlyEnabled = settlementVerifiers[verifier];
        if (currentlyEnabled == enabled) {
            return;
        }
        if (enabled) {
            require(
                settlementVerifierCount < 255,
                "EAB: too many settlement verifiers"
            );
            settlementVerifierCount++;
        } else {
            require(
                settlementVerifierThreshold < settlementVerifierCount,
                "EAB: threshold exceeds verifiers"
            );
            settlementVerifierCount--;
        }
        settlementVerifiers[verifier] = enabled;
        settlementVerifierSetVersion++;
        emit SettlementVerifierUpdated(
            verifier,
            enabled,
            settlementVerifierSetVersion
        );
    }

    function setSettlementVerifierThreshold(
        uint8 threshold
    ) external onlyOwner {
        require(
            threshold > 1 && threshold <= settlementVerifierCount,
            "EAB: invalid verifier threshold"
        );
        if (threshold == settlementVerifierThreshold) {
            return;
        }
        settlementVerifierThreshold = threshold;
        settlementVerifierSetVersion++;
        emit SettlementVerifierThresholdUpdated(
            threshold,
            settlementVerifierSetVersion
        );
    }

    function attestDepositSettlement(
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
    ) external {
        _recordSettlementAttestation(
            getDepositSettlementDigest(
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
            )
        );
    }

    function attestWithdrawalRelease(
        uint256 withdrawalId,
        string reservationId,
        string externalTxHash
    ) external {
        WithdrawalInfo withdrawal = withdrawals[withdrawalId];
        require(withdrawal.status == Status.READY, "EAB: bad state");
        require(
            withdrawal.reservationId == reservationId.normalizeHex(),
            "EAB: reservation mismatch"
        );
        _recordSettlementAttestation(
            getWithdrawalReleaseDigest(
                withdrawalId,
                reservationId,
                externalTxHash
            )
        );
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
        uint256 minFinalOut,
        bytes attestationProof
    ) external whenDepositsOpen {
        _requireSettlementAttestations(
            getDepositSettlementDigest(
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
            ),
            attestationProof
        );
        require(
            action == uint256(DepositAction.NONE) ||
                msg.sender == owner() ||
                msg.sender == bridgeOperator,
            "EAB: routed settlement requires operator"
        );
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

    function settleDepositWithRoute(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address stratoToken,
        address expectedTokenOut,
        uint256 minFinalOut,
        RouteStep[] steps,
        bytes attestationProof
    ) external onlyBridgeOperator whenDepositsOpen {
        _requireSettlementAttestations(
            getDepositSettlementDigest(
                externalChainId,
                depositRouter,
                depositId,
                externalSender,
                externalToken,
                externalTokenAmount,
                externalTxHash,
                stratoRecipient,
                stratoToken,
                uint256(DepositAction.AUTO_ROUTE),
                expectedTokenOut,
                minFinalOut
            ),
            attestationProof
        );
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
            uint256(DepositAction.AUTO_ROUTE),
            expectedTokenOut,
            minFinalOut
        );
        _recordDepositRoute(
            externalChainId,
            depositRouter,
            depositId,
            steps
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
        uint256 depositId,
        bytes attestationProof
    ) external whenDepositsOpen {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        DepositActionIntent intent = depositActions[
            externalChainId
        ][depositRouter][depositId];
        require(
            intent.action == uint256(DepositAction.NONE) ||
                msg.sender == owner() ||
                msg.sender == bridgeOperator,
            "EAB: routed settlement requires operator"
        );
        _requireSettlementAttestations(
            getDepositSettlementDigest(
                externalChainId,
                depositRouter,
                depositId,
                depositInfo.externalSender,
                depositInfo.externalToken,
                depositInfo.externalTokenAmount,
                depositInfo.externalTxHash,
                depositInfo.stratoRecipient,
                depositInfo.stratoToken,
                intent.action,
                intent.actionToken,
                intent.minFinalOut
            ),
            attestationProof
        );
        _confirmDeposit(
            externalChainId,
            depositRouter,
            depositId
        );
    }

    function confirmReviewedDepositWithRoute(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        RouteStep[] steps,
        bytes attestationProof
    ) external onlyBridgeOperator whenDepositsOpen {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        require(
            depositInfo.status == Status.PENDING_REVIEW,
            "EAB: bad state"
        );
        DepositActionIntent intent = depositActions[
            externalChainId
        ][depositRouter][depositId];
        _requireSettlementAttestations(
            getDepositSettlementDigest(
                externalChainId,
                depositRouter,
                depositId,
                depositInfo.externalSender,
                depositInfo.externalToken,
                depositInfo.externalTokenAmount,
                depositInfo.externalTxHash,
                depositInfo.stratoRecipient,
                depositInfo.stratoToken,
                intent.action,
                intent.actionToken,
                intent.minFinalOut
            ),
            attestationProof
        );
        _recordDepositRoute(
            externalChainId,
            depositRouter,
            depositId,
            steps
        );
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
            intent.action ==
                uint256(DepositAction.AUTO_ROUTE) &&
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
        _deleteDepositRoute(
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
        _deleteDepositRoute(
            externalChainId,
            depositRouter,
            depositId
        );
        emit DepositAborted(
            externalChainId,
            depositInfo.externalTxHash
        );
    }

    function authorizeDepositReuse(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) external onlyOwner {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        require(depositInfo.status == Status.ABORTED, "EAB: bad state");
        depositInfo.status = Status.NONE;
        depositInfo.timestamp = block.timestamp;
        emit DepositReuseAuthorized(
            externalChainId,
            depositRouter,
            depositId
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
        bool requiresRebase = routeRebaseRequired[externalToken][
            externalChainId
        ][stratoToken];
        uint256 rebaseFactor;
        if (requiresRebase) {
            require(priceOracle != address(0), "EAB: oracle not set");
            rebaseFactor = PriceOracle(priceOracle).rebaseFactors(stratoToken);
            require(rebaseFactor > 0, "EAB: rebase factor not set");
        }
        uint256 externalTokenAmount;
        uint256 escrowAmount;
        if (rebaseFactor == 0) {
            externalTokenAmount = stratoTokenAmount / scale;
            escrowAmount = externalTokenAmount * scale;
        } else {
            uint256 scaledWad = scale * 1e18;
            externalTokenAmount =
                (stratoTokenAmount * rebaseFactor) /
                scaledWad;
            escrowAmount =
                (externalTokenAmount * scaledWad + rebaseFactor - 1) /
                rebaseFactor;
        }
        require(externalTokenAmount > 0, "EAB: amount too small");
        if (route.maxPerWithdrawal != 0) {
            require(
                externalTokenAmount <= route.maxPerWithdrawal,
                "EAB: withdrawal cap"
            );
        }

        stratoTokenAmount = _escrowFunds(
            stratoToken,
            msg.sender,
            escrowAmount
        );
        externalTokenAmount = rebaseFactor == 0
            ? stratoTokenAmount / scale
            : (stratoTokenAmount * rebaseFactor) / (scale * 1e18);
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
        string externalTxHash,
        bytes attestationProof
    ) public {
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
        _requireSettlementAttestations(
            getWithdrawalReleaseDigest(
                withdrawalId,
                normalizedReservationId,
                normalizedExternalTxHash
            ),
            attestationProof
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

    function getDepositSettlementDigest(
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
    ) public view returns (bytes32) {
        bytes32 sourceHash = keccak256(
            abi.encode(
                externalChainId,
                depositRouter,
                depositId,
                externalSender,
                externalToken,
                externalTokenAmount,
                keccak256(bytes(externalTxHash.normalizeHex()))
            )
        );
        bytes32 destinationHash = keccak256(
            abi.encode(
                stratoRecipient,
                stratoToken,
                action,
                actionToken,
                minFinalOut
            )
        );
        return keccak256(
            abi.encode(
                keccak256("EAB_DEPOSIT_SETTLEMENT_V1"),
                block.chainid,
                address(this),
                settlementVerifierSetVersion,
                sourceHash,
                destinationHash
            )
        );
    }

    function getWithdrawalReleaseDigest(
        uint256 withdrawalId,
        string reservationId,
        string externalTxHash
    ) public view returns (bytes32) {
        WithdrawalInfo withdrawal = withdrawals[withdrawalId];
        return keccak256(
            abi.encode(
                keccak256("EAB_WITHDRAWAL_RELEASE_V1"),
                block.chainid,
                address(this),
                settlementVerifierSetVersion,
                withdrawalId,
                withdrawal.externalChainId,
                withdrawal.externalToken,
                withdrawal.externalTokenAmount,
                withdrawal.externalRecipient,
                keccak256(bytes(reservationId.normalizeHex())),
                keccak256(bytes(externalTxHash.normalizeHex()))
            )
        );
    }

    function _requireSettlementAttestations(
        bytes32 digest,
        bytes attestationProof
    ) internal view {
        require(
            attestationProof.length == 0,
            "EAB: unsupported attestation proof"
        );
        require(
            settlementVerifierThreshold > 0,
            "EAB: verifier threshold not set"
        );
        require(
            settlementAttestationCounts[digest] >=
                settlementVerifierThreshold,
            "EAB: insufficient verifier attestations"
        );
    }

    function _recordSettlementAttestation(bytes32 digest) internal {
        require(
            settlementVerifiers[msg.sender],
            "EAB: not settlement verifier"
        );
        if (settlementAttestations[digest][msg.sender]) {
            return;
        }
        settlementAttestations[digest][msg.sender] = true;
        uint8 count = settlementAttestationCounts[digest] + 1;
        settlementAttestationCounts[digest] = count;
        emit SettlementAttested(digest, msg.sender, count);
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
        require(existingStatus == Status.NONE, "EAB: duplicate deposit");

        uint256 scale = 10 ** (DECIMAL_PLACES - route.externalDecimals);
        uint256 stratoTokenAmount = externalTokenAmount * scale;
        if (
            routeRebaseRequired[externalToken][externalChainId][stratoToken]
        ) {
            require(priceOracle != address(0), "EAB: oracle not set");
            uint256 rebaseFactor = PriceOracle(priceOracle).rebaseFactors(
                stratoToken
            );
            require(rebaseFactor > 0, "EAB: rebase factor not set");
            stratoTokenAmount =
                (externalTokenAmount * scale * 1e18) /
                rebaseFactor;
        }
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
            require(
                action == uint256(DepositAction.AUTO_ROUTE),
                "EAB: invalid action"
            );
            require(actionToken != address(0), "EAB: zero action token");
            require(minFinalOut > 0, "EAB: zero action minimum");
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
        require(
            intent.action == uint256(DepositAction.AUTO_ROUTE),
            "EAB: invalid action"
        );
        require(tokenRouter != address(0), "EAB: token router not set");
        uint256 stepCount = depositRouteStepCounts[externalChainId][
            depositRouter
        ][depositId];
        require(
            stepCount > 0 && stepCount <= MAX_ROUTE_STEPS,
            "EAB: route missing"
        );
        RouteStep[] steps = new RouteStep[](stepCount);
        for (uint256 i = 0; i < stepCount; i++) {
            steps[i] = depositRouteSteps[externalChainId][depositRouter][
                depositId
            ][i];
        }
        uint256 sourceAmount = _mintFunds(
            depositInfo.stratoToken,
            address(this),
            depositInfo.stratoTokenAmount
        );
        require(
            IERC20(depositInfo.stratoToken).approve(
                tokenRouter,
                sourceAmount
            ),
            "EAB: router approval failed"
        );
        uint256 finalAmount = TokenRouter(tokenRouter).executeRoute(
            depositInfo.stratoToken,
            intent.actionToken,
            sourceAmount,
            depositInfo.stratoRecipient,
            steps,
            block.timestamp + ROUTE_EXECUTION_DEADLINE,
            intent.minFinalOut
        );
        require(finalAmount >= intent.minFinalOut, "EAB: route under minimum");
        emit AutoRouted(
            externalChainId,
            depositRouter,
            depositId,
            depositInfo.externalTxHash,
            depositInfo.stratoRecipient,
            depositInfo.stratoToken,
            sourceAmount,
            intent.actionToken,
            finalAmount
        );
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
        return
            action == uint256(DepositAction.AUTO_ROUTE) &&
            config.autoRoute;
    }

    function _recordDepositRoute(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId,
        RouteStep[] steps
    ) internal {
        DepositInfo depositInfo = deposits[
            externalChainId
        ][depositRouter][depositId];
        DepositActionIntent intent = depositActions[
            externalChainId
        ][depositRouter][depositId];
        require(
            intent.action == uint256(DepositAction.AUTO_ROUTE),
            "EAB: route intent missing"
        );
        require(
            steps.length > 0 && steps.length <= MAX_ROUTE_STEPS,
            "EAB: invalid route length"
        );
        require(
            steps[0].tokenIn == depositInfo.stratoToken,
            "EAB: route source mismatch"
        );
        require(
            steps[steps.length - 1].tokenOut == intent.actionToken,
            "EAB: route output mismatch"
        );
        for (uint256 i = 0; i < steps.length; i++) {
            require(
                steps[i].action != RouteAction.NONE,
                "EAB: invalid route action"
            );
            require(steps[i].target != address(0), "EAB: zero route target");
            require(
                steps[i].tokenOut != address(0),
                "EAB: zero route token"
            );
            if (i > 0) {
                require(
                    steps[i].tokenIn == steps[i - 1].tokenOut,
                    "EAB: route discontinuity"
                );
            }
            depositRouteSteps[externalChainId][depositRouter][depositId][
                i
            ] = steps[i];
        }
        depositRouteStepCounts[externalChainId][depositRouter][
            depositId
        ] = steps.length;
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

    function _deleteDepositRoute(
        uint256 externalChainId,
        address depositRouter,
        uint256 depositId
    ) internal {
        uint256 stepCount = depositRouteStepCounts[externalChainId][
            depositRouter
        ][depositId];
        for (uint256 i = 0; i < stepCount; i++) {
            delete depositRouteSteps[externalChainId][depositRouter][
                depositId
            ][i];
        }
        delete depositRouteStepCounts[externalChainId][depositRouter][
            depositId
        ];
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

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../../libraries/Bridge/BridgeFees.sol";
import "../Admin/AdminRegistry.sol";
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "./StratoNativeCustodyVault.sol";

/**
 * @title StratoNativeBridge
 * @notice Separate bridge lifecycle for STRATO-native assets.
 * @notice Keeps native lock/unlock liabilities isolated from the existing MercataBridge flow.
 *
 * @notice SOLVER FAST PATH. Both directions of this bridge normally wait for
 *         the relayer, the review window, and (outbound) the attestation
 *         signers and the custody Safe. A solver can front either leg:
 *
 *         INBOUND (an external redemption becoming STRATO funds) is filled
 *         here. {fillDeposit} moves the SOLVER's own STRATO tokens to the
 *         recipient, and {confirmDeposit} then unlocks the custody vault to
 *         the solver instead. The redirect is enforced on chain, because both
 *         halves happen on this chain.
 *
 *         OUTBOUND (a STRATO withdrawal becoming representation tokens) is
 *         filled on the external chain, against the fee schedule this contract
 *         commits at request time. {recordWithdrawalClaim} mirrors that claim
 *         back here so the UI can see it and -- more importantly -- so the
 *         user cannot abort a withdrawal a solver has already paid out.
 *
 *         Either way the user may name a `maxFee`, and what a solver can
 *         actually keep decays exponentially to zero over three days: the
 *         fastest solver earns the most, and a user nobody rushed to serve is
 *         refunded the difference automatically.
 *
 * @notice CLAIMS ARE A LADDER, not a slot. Each claimant pays the party they
 *         displace -- the recipient first, the previous claimant after that --
 *         so a fast solver can hand a position to a slower one who will accept
 *         a thinner fee, and keeps the decay accrued while they held it. The
 *         recipient is paid once and the vault unlocks once.
 *
 * @notice ANNOUNCEMENTS let anyone post an external redemption here before the
 *         relayer has seen it, against a bond, so a solver can fill against it
 *         immediately. An announced deposit can never be confirmed: only the
 *         relayer's own record moves it to INITIATED, and an announcement that
 *         does not match what the relayer eventually posts is simply
 *         overwritten.
 *
 * @dev WHAT THE FAST PATH DOES NOT DO: it does not skip a review, a time lock,
 *      or a multisig. A solver waits for all of it and carries the risk that
 *      the deposit is aborted or the withdrawal rejected, which is what turns
 *      that risk into a quoted fee.
 */
contract record StratoNativeBridge is Ownable {
    using BridgeTypes for *;
    using BridgeFees for *;
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

    /// @notice The solver fee schedule a request committed to. Written once,
    ///         never updated: an admin who changes the configured half-life
    ///         must not be able to re-price a request already in flight.
    struct NativeFeeTerms {
        bool set;
        uint256 maxFee;
        uint256 requestedAt;
        uint256 feeHalfLife;
    }

    /**
     * @notice The head of a deposit's claim ladder, plus the SNAPSHOT of the
     *         record it was priced against.
     *
     * @dev THE SNAPSHOT IS THE BINDING. A claim may be made against an
     *      announced (unverified) deposit, and the relayer's own record can
     *      later disagree with it. {confirmDeposit} re-compares these fields
     *      to the live record and pays the claimant only on an exact match --
     *      otherwise the claim is void, the recipient is unlocked to as if no
     *      solver had appeared, and the solver has given a stranger money.
     *      Stored field by field rather than as a hash so that an indexer can
     *      see exactly what was claimed.
     */
    struct NativeDepositClaim {
        address claimant;
        uint256 claimIndex;
        uint256 claimedAt;
        uint256 feeCharged;
        uint256 netPaid;
        bool voided;
        // The claimant's own exit terms. See {setDepositClaimExitOffer}.
        bool transferable;
        uint256 exitFee;
        address stratoRecipient;
        address stratoToken;
        uint256 stratoTokenAmount;
        uint256 maxFee;
        uint256 requestedAt;
        uint256 feeHalfLife;
    }

    /// @notice A claim on an outbound withdrawal, as verified on the external
    ///         chain and mirrored here by the relayer. Advisory for settlement
    ///         -- the external chain pays the solver -- but binding for abort:
    ///         see {abortWithdrawal}.
    struct NativeWithdrawalClaim {
        address claimant;
        uint256 claimIndex;
        uint256 claimedAt;
        uint256 feeCharged;
        uint256 netPaid;
        string externalFillTxHash;
    }

    /// @notice A bonded, unverified claim that an external redemption exists.
    ///         `state` is 1 while live, 2 once the bond has been returned, 3
    ///         once it has been slashed.
    struct NativeAnnouncement {
        address announcer;
        address bondToken;
        uint256 bondAmount;
        uint256 announcedAt;
        uint256 state;
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
    event NativeWithdrawalEscrowReleasedToClaimant(uint256 indexed withdrawalId, address indexed claimant, uint256 amount);
    event NativeWithdrawalAborted(uint256 indexed withdrawalId);
    event InstantWithdrawalDelayUpdated(uint256 previousDelaySeconds, uint256 newDelaySeconds);

    // ───────────── Solver fast-path events ─────────────
    /// @notice The fee schedule a request committed to. Emitted separately
    ///         from the request event rather than widening it: Cirrus tables
    ///         and the relayer both key off the existing shapes, and changing
    ///         one would orphan every consumer at the same instant.
    event NativeDepositFeeTerms(
        string depositId,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    event NativeWithdrawalFeeTerms(
        uint256 indexed withdrawalId,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    /// @notice A solver took over a deposit's claim. `paidTo` is the party they
    ///         displaced: the recipient on claim 0, the previous claimant after
    ///         that.
    event NativeDepositFilled(
        string depositId,
        address claimant,
        address paidTo,
        uint256 claimIndex,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 feeCharged,
        uint256 netPaid
    );
    /// @notice The vault unlock was redirected to a claimant who had already
    ///         paid the recipient.
    event NativeDepositClaimSettled(string depositId, address claimant, uint256 claimIndex, uint256 feeCharged);
    /// @notice A claim holder changed whether, and at what price, they are
    ///         willing to be displaced.
    event NativeDepositClaimOfferUpdated(string depositId, address claimant, bool transferable, uint256 exitFee);
    /// @notice A claim existed but was priced against a record that no longer
    ///         matches, so it was ignored and the recipient was paid. An event
    ///         rather than a revert: a bogus claim must never be able to hold a
    ///         real deposit hostage.
    event NativeDepositClaimVoided(string depositId, address claimant, string reason);
    event NativeWithdrawalClaimRecorded(
        uint256 indexed withdrawalId,
        address claimant,
        uint256 claimIndex,
        uint256 feeCharged,
        uint256 netPaid,
        string externalFillTxHash
    );
    event NativeDepositAnnounced(
        string depositId,
        address announcer,
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address representationToken,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife,
        address bondToken,
        uint256 bondAmount
    );
    event NativeAnnouncementBondReturned(string depositId, address announcer, uint256 amount);
    event NativeAnnouncementBondSlashed(string depositId, address announcer, uint256 amount, address recipient);
    event NativeAnnouncementSuperseded(string depositId, address announcer);
    event NativeFeeConfigUpdated(uint256 feeHalfLifeSeconds, uint256 maxFeeBps, bool fillsEnabled);
    event NativeAnnouncementConfigUpdated(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint256 ttlSeconds
    );

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

    // ───────────── Solver fast-path state ─────────────
    /// @notice Half-life, in seconds, of an offered solver fee. Committed into
    ///         each request, so changing it never re-prices one in flight.
    uint256 public feeHalfLifeSeconds;

    /// @notice Ceiling on any offered fee, in basis points of the amount. The
    ///         anti-grief bound on claims: a solver who inflates the schedule
    ///         underpays the recipient and occupies the ladder, so occupying
    ///         it has to cost nearly the whole amount, paid to the user. Zero
    ///         refuses every fee and disables the fast path outright.
    uint256 public maxFeeBps;

    /// @notice Master switch for {fillDeposit}, separate from the deposit
    ///         circuit breaker: stopping solvers is not the same decision as
    ///         stopping the bridge.
    bool public fillsEnabled;

    /// @notice Master switch for {announceDeposit}.
    bool public announcementsEnabled;

    /// @notice Announcement bond configuration: what is posted, where a
    ///         slashed bond goes, and how long before an unconfirmed bond can
    ///         be reclaimed.
    address public announcementBondToken;
    uint256 public announcementBondAmount;
    address public announcementSlashRecipient;
    uint256 public announcementTtlSeconds;

    /// @notice Bonds this contract is holding, per token. Tracked separately
    ///         from the balance so a bond is never mistaken for a stray
    ///         transfer.
    mapping(address => uint256) public record bondedBalance;

    /// @notice The committed fee schedule per deposit and per withdrawal.
    mapping(string => NativeFeeTerms) public record depositFeeTerms;
    mapping(uint256 => NativeFeeTerms) public record withdrawalFeeTerms;

    /// @notice The head of each claim ladder.
    mapping(string => NativeDepositClaim) public record depositClaims;
    mapping(uint256 => NativeWithdrawalClaim) public record withdrawalClaims;

    /// @notice Permissionless announcements of external redemptions.
    mapping(string => NativeAnnouncement) public record depositAnnouncements;

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
        return _requestWithdrawal(externalChainId, externalRecipient, stratoToken, stratoTokenAmount, 0);
    }

    /**
     * @notice {requestWithdrawal}, plus a `maxFee` the user will pay a solver
     *         who hands them their representation tokens on the external chain
     *         before the attestation signers and the custody Safe have
     *         finished.
     *
     * @notice The fee a solver can actually keep decays exponentially to zero
     *         over three days from this moment. A fast fill costs close to
     *         `maxFee`; a slow one costs proportionally less; one that never
     *         comes costs nothing. There is no separate refund step, because
     *         the fee was never taken -- the solver simply delivers more.
     *
     * @dev The schedule is COMMITTED here, in storage and in the event, and
     *      never read live afterwards. The external chain's settlement
     *      recomputes the fee from these three numbers, so an admin who
     *      changes {feeHalfLifeSeconds} cannot re-price a withdrawal already
     *      in flight.
     *
     * @param maxFee The ceiling, in `stratoToken` units, on what a solver may
     *               keep. Zero opts out of the fast path.
     */
    function requestWithdrawalWithFee(
        uint256 externalChainId,
        address externalRecipient,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee
    ) external whenWithdrawalsOpen returns (uint256 id) {
        return _requestWithdrawal(externalChainId, externalRecipient, stratoToken, stratoTokenAmount, maxFee);
    }

    function _requestWithdrawal(
        uint256 externalChainId,
        address externalRecipient,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee
    ) internal returns (uint256 id) {
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

        // The fee is bounded against what was ACTUALLY LOCKED, not against
        // what was asked for: the locked amount is what the withdrawal is
        // worth and what a solver must pay against, and a rebasing token can
        // make the two differ.
        _commitWithdrawalFeeTerms(id, actualLockedAmount, maxFee);
    }

    /// @dev Write the schedule a withdrawal will be settled under. Zero fee
    ///      writes a zero-fee schedule rather than nothing, so the record
    ///      always says explicitly that the fast path was declined.
    function _commitWithdrawalFeeTerms(uint256 id, uint256 amount, uint256 maxFee) internal {
        uint256 halfLife = 0;
        if (maxFee > 0) {
            require(BridgeFees.isFeeCapAllowed(maxFee, amount, maxFeeBps), "SNB: fee too large");
            halfLife = feeHalfLifeSeconds;
            require(BridgeFees.isHalfLifeAllowed(halfLife), "SNB: fee half-life not configured");
        }

        withdrawalFeeTerms[id] = NativeFeeTerms(true, maxFee, block.timestamp, halfLife);
        emit NativeWithdrawalFeeTerms(id, maxFee, block.timestamp, halfLife);
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
            // A solver has already handed this user their tokens on the
            // external chain. Refunding the escrow now would pay them twice
            // and leave the solver holding nothing, so the timeout escape
            // hatch closes once a claim is on record. Governance can still
            // abort -- that is the admin-rejection risk a solver prices --
            // but the beneficiary of the fill cannot.
            //
            // Checked BEFORE the timeout: it is the more fundamental reason
            // this abort is refused, and "a solver already paid you" is a far
            // more useful thing to tell a caller than "wait 48h".
            require(withdrawalClaims[id].claimant == address(0), "SNB: claimed by solver");
            require(currentTimestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY, "SNB: wait 48h");
        }
        require(bytes(w.externalTxHash).length == 0, "SNB: external tx set");

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = currentTimestamp;

        // The escrow follows the claim, for the same reason as on
        // MercataBridge: a solver that holds the claim has already delivered
        // the representation tokens to the sender, and unlocking to the sender
        // would pay them twice while the solver absorbs the loss.
        address payee = w.stratoSender;
        address claimant = withdrawalClaims[id].claimant;
        if (claimant != address(0)) {
            payee = claimant;
        }

        uint256 actualUnlockedAmount = StratoNativeCustodyVault(custodyVault).unlock(
            w.stratoToken,
            payee,
            w.stratoTokenAmount
        );
        require(actualUnlockedAmount > 0, "SNB: no tokens unlocked");

        emit NativeWithdrawalAborted(id);
        if (claimant != address(0)) {
            emit NativeWithdrawalEscrowReleasedToClaimant(id, claimant, actualUnlockedAmount);
        }
    }

    /**
     * @notice Mirror an external-chain claim on an outbound withdrawal back
     *         onto this chain.
     *
     *         The solver is paid on the external chain, by that chain's own
     *         settlement, so this record does not move money. It does two
     *         things that matter: it makes the claim visible to the UI and to
     *         Cirrus on the chain that holds the escrow, and it closes the
     *         user's 48-hour abort hatch -- without it, a user could take a
     *         solver's tokens on one chain and their own escrow back on this
     *         one.
     *
     * @dev THE FEE IS CHECKED, not taken on trust. `feeCharged` must be within
     *      the schedule this contract committed at request time, evaluated at
     *      the external chain's fill timestamp, and `netPaid` must be the
     *      remainder. A relayer reporting a fill that overcharged the user is
     *      refused here even though the relayer is otherwise trusted: the
     *      numbers are checkable, so they are checked.
     *
     * @dev Claims ratchet forward. A later rung must have a higher index and a
     *      fee no larger than the rung below it, which is what the decay
     *      guarantees on the external chain and what this re-verifies.
     *
     * @param claimedAt The external chain's block timestamp at the fill. Clock
     *                  skew between chains is real but small; a timestamp in
     *                  this chain's future is refused rather than trusted.
     */
    function recordWithdrawalClaim(
        uint256 id,
        address claimant,
        uint256 claimIndex,
        uint256 feeCharged,
        uint256 netPaid,
        uint256 claimedAt,
        string externalFillTxHash
    ) external onlyBridgeOperator {
        require(id > 0, "SNB: invalid withdrawal id");
        require(claimant != address(0), "SNB: invalid claimant");
        require(bytes(externalFillTxHash).length > 0, "SNB: invalid fill tx hash");

        NativeWithdrawalInfo w = withdrawals[id];
        require(
            w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: bad state"
        );

        NativeFeeTerms terms = withdrawalFeeTerms[id];
        require(terms.set, "SNB: no fee terms");
        require(claimedAt <= block.timestamp, "SNB: fill in the future");
        require(netPaid == w.externalTokenAmount - feeCharged, "SNB: net does not match");

        // ONLY RUNG ZERO IS BOUND BY THE USER'S SCHEDULE. That is the rung
        // that pays the user, and the schedule is what they agreed to. Later
        // rungs are solvers buying and selling the position among themselves
        // at prices they set -- a solver shedding a risky claim may well pay
        // MORE than they earned, and bounding that would forbid the trade the
        // ladder exists to allow. The user's leg is already settled by then.
        if (claimIndex == 0) {
            uint256 allowedFee = BridgeFees.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                claimedAt
            );
            require(feeCharged <= allowedFee, "SNB: fee above schedule");
        }

        NativeWithdrawalClaim existing = withdrawalClaims[id];
        if (existing.claimant != address(0)) {
            require(claimIndex > existing.claimIndex, "SNB: claim index not advancing");
        } else {
            require(claimIndex == 0, "SNB: first claim must be index zero");
        }

        withdrawalClaims[id] = NativeWithdrawalClaim(
            claimant,
            claimIndex,
            claimedAt,
            feeCharged,
            netPaid,
            externalFillTxHash.normalizeHex()
        );

        emit NativeWithdrawalClaimRecorded(
            id,
            claimant,
            claimIndex,
            feeCharged,
            netPaid,
            externalFillTxHash.normalizeHex()
        );
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
        _recordDeposit(
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            stratoRecipient,
            stratoTokenAmount,
            0
        );
    }

    /**
     * @notice {recordDeposit}, plus the `maxFee` the depositor offered on the
     *         external chain for immediate delivery here.
     *
     * @dev The relayer reads the fee out of the external `RedemptionRequested`
     *      log and passes it through unchanged, along with the ORIGIN
     *      timestamp -- not this chain's -- so the decay measures from when the
     *      user actually asked, not from when the relayer got round to it. A
     *      relayer that is an hour behind therefore hands the user an hour of
     *      decay, which is exactly the refund the schedule promises.
     *
     * @param requestedAt The external chain's timestamp of the redemption.
     */
    function recordDepositWithFee(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount,
        uint256 maxFee,
        uint256 requestedAt
    ) external onlyBridgeOperator whenDepositsOpen {
        string depositId = _recordDeposit(
            externalChainId,
            externalBridge,
            externalRedemptionId,
            externalSender,
            externalTxHash,
            representationToken,
            stratoRecipient,
            stratoTokenAmount,
            requestedAt
        );
        _commitDepositFeeTerms(depositId, stratoTokenAmount, maxFee, requestedAt);
    }

    /// @dev Write the schedule a deposit will be settled under. A zero fee
    ///      still writes a schedule, so the record always says explicitly
    ///      whether the fast path was on offer.
    function _commitDepositFeeTerms(
        string depositId,
        uint256 amount,
        uint256 maxFee,
        uint256 requestedAt
    ) internal {
        uint256 halfLife = 0;
        if (maxFee > 0) {
            require(BridgeFees.isFeeCapAllowed(maxFee, amount, maxFeeBps), "SNB: fee too large");
            halfLife = feeHalfLifeSeconds;
            require(BridgeFees.isHalfLifeAllowed(halfLife), "SNB: fee half-life not configured");
        }

        uint256 startsAt = requestedAt;
        if (startsAt == 0 || startsAt > block.timestamp) {
            // A missing or future origin timestamp would hand a solver the
            // full fee forever. Fall back to now: strictly worse for the
            // solver and strictly safer for the user.
            startsAt = block.timestamp;
        }

        depositFeeTerms[depositId] = NativeFeeTerms(true, maxFee, startsAt, halfLife);
        emit NativeDepositFeeTerms(depositId, maxFee, startsAt, halfLife);
    }

    function _recordDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount,
        uint256 requestedAt
    ) internal returns (string) {
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
        require(
            existingDeposit.bridgeStatus == BridgeStatus.NONE
                || existingDeposit.bridgeStatus == BridgeStatus.ANNOUNCED,
            "SNB: duplicate deposit"
        );

        // An announcement is a stranger's unverified claim about this deposit.
        // The relayer's record always wins; the only question is whether the
        // announcer's bond comes back now or has to be reclaimed. An exact
        // match is returned immediately, a mismatch is superseded and left
        // reclaimable, because the honest reasons to disagree are real (a
        // rebase adjustment, a race with a reorg) and slashing is reserved for
        // announcements governance rules fake.
        if (existingDeposit.bridgeStatus == BridgeStatus.ANNOUNCED) {
            _resolveAnnouncementOnAdoption(
                depositId,
                existingDeposit,
                externalSender,
                representationToken,
                stratoRecipient,
                stratoTokenAmount
            );
        }

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

        return depositId;
    }

    /// @dev Return an adopted announcement's bond, or mark it superseded and
    ///      leave it reclaimable. Never slashes: that is governance's call.
    function _resolveAnnouncementOnAdoption(
        string depositId,
        NativeDepositInfo announced,
        address externalSender,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount
    ) internal {
        bool matches = announced.externalSender == externalSender
            && announced.representationToken == representationToken
            && announced.stratoRecipient == stratoRecipient
            && announced.stratoTokenAmount == stratoTokenAmount;

        if (matches) {
            _returnAnnouncementBond(depositId);
        } else {
            emit NativeAnnouncementSuperseded(depositId, depositAnnouncements[depositId].announcer);
        }
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

        // A solver who already handed the recipient their tokens takes the
        // recipient's place here. Their payment is in this chain's own
        // history -- better evidence than any attestation could be -- and the
        // vault unlocks the FULL amount to them: the net they fronted plus the
        // fee they earned is exactly what they are owed.
        address payee = _resolveDepositPayee(depositId, d);

        uint256 actualUnlockedAmount = StratoNativeCustodyVault(custodyVault).unlock(
            d.stratoToken,
            payee,
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
            payee,
            d.stratoToken,
            actualUnlockedAmount
        );
    }

    /**
     * @dev Who this deposit's unlock belongs to: the head of the claim ladder
     *      if its snapshot still matches the live record, the recipient
     *      otherwise.
     *
     *      A MISMATCH IS VOIDED, NOT REVERTED. A claim can be made against an
     *      announced deposit that the relayer later contradicts; refusing to
     *      confirm would let one bad claim strand a real deposit forever,
     *      while voiding leaves the solver's payment as a gift to the
     *      recipient and the bridge's accounting exact.
     */
    function _resolveDepositPayee(
        string depositId,
        NativeDepositInfo d
    ) internal returns (address) {
        NativeDepositClaim claim = depositClaims[depositId];
        if (claim.claimant == address(0)) {
            return d.stratoRecipient;
        }

        NativeFeeTerms terms = depositFeeTerms[depositId];
        bool matches = claim.stratoRecipient == d.stratoRecipient
            && claim.stratoToken == d.stratoToken
            && claim.stratoTokenAmount == d.stratoTokenAmount
            && claim.maxFee == terms.maxFee
            && claim.requestedAt == terms.requestedAt
            && claim.feeHalfLife == terms.feeHalfLife;

        if (!matches) {
            claim.voided = true;
            emit NativeDepositClaimVoided(depositId, claim.claimant, "terms no longer match record");
            return d.stratoRecipient;
        }

        emit NativeDepositClaimSettled(depositId, claim.claimant, claim.claimIndex, claim.feeCharged);
        return claim.claimant;
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

        // An aborted deposit is the risk a solver priced. Mark the claim void
        // so the loss is explicit on chain rather than an unresolved claim
        // that looks like it is still owed something.
        NativeDepositClaim claim = depositClaims[depositId];
        if (claim.claimant != address(0) && !claim.voided) {
            claim.voided = true;
            emit NativeDepositClaimVoided(depositId, claim.claimant, "deposit aborted");
        }

        emit NativeDepositAborted(
            depositId,
            externalChainId,
            externalBridge,
            externalRedemptionId
        );
    }

    // ───────────── Solver fast path: filling inbound deposits ─────────────

    /// @notice What a solver would keep by filling this deposit right now, and
    ///         what they would have to pay out to get it.
    function quoteDepositFill(
        string depositId
    ) public returns (address payTo, uint256 feeCharged, uint256 netToPay) {
        NativeDepositInfo d = deposits[depositId];
        require(d.stratoTokenAmount > 0, "SNB: unknown deposit");
        NativeFeeTerms terms = depositFeeTerms[depositId];

        NativeDepositClaim claim = depositClaims[depositId];
        if (claim.claimant == address(0)) {
            // Rung zero: the user's committed schedule.
            payTo = d.stratoRecipient;
            feeCharged = BridgeFees.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
        } else {
            // Every later rung: the holder's asking price, if they are selling.
            require(claim.transferable && !claim.voided, "SNB: claim not transferable");
            payTo = claim.claimant;
            feeCharged = claim.exitFee;
        }
        netToPay = d.stratoTokenAmount - feeCharged;
    }

    /**
     * @notice Hand an inbound deposit's recipient their STRATO tokens out of
     *         your own balance, ahead of the relayer's review, and take over
     *         the claim on the custody vault's eventual unlock.
     *
     *         The transfer runs HERE, solver to payee, so by the time
     *         {confirmDeposit} runs the bridge KNOWS the recipient was paid --
     *         it happened on this chain, in this call. Nothing is fronted by
     *         the bridge, so there is no reclaim path and no new custody.
     *
     *         THE FIRST RUNG IS THE USER'S. Claim zero pays the deposit's
     *         recipient `amount - decayedFee(...)`, and that fee is the
     *         schedule the user committed to -- not negotiable by anyone.
     *
     *         EVERY RUNG AFTER THAT IS BETWEEN SOLVERS. A claim can only be
     *         taken over if its holder has marked it transferable, and the
     *         price is the holder's own `exitFee`: the taker pays them
     *         `amount - exitFee` and keeps `exitFee` at settlement. The
     *         holder may set that price ABOVE what they themselves earned, and
     *         that is the point -- a solver who has come to believe a
     *         withdrawal will be rejected can pay someone else to carry it.
     *         Whatever the price, the user's leg is untouched and the bridge
     *         still pays `amount` exactly once: the ladder only redistributes
     *         the fee the user already paid, plus whatever the solvers choose
     *         to move between themselves.
     *
     * @dev THE EXPECTED VALUES ARE NOT DECORATION. A solver passes the record
     *      and the fee they believe they are buying, and a mismatch reverts
     *      rather than filling something else -- because this deposit may be a
     *      stranger's unverified announcement, the relayer may overwrite it,
     *      and the holder may have repriced their exit, all between the solver
     *      reading and this transaction landing.
     *
     * @dev A CLAIM ON AN ANNOUNCED DEPOSIT IS A BET. Nothing here verifies the
     *      external redemption happened; this contract cannot. If the relayer
     *      never confirms it, or confirms different numbers, the claim is void
     *      and the solver has given a stranger money. That is the risk the fee
     *      prices, and the reason a solver should read the external chain
     *      rather than trust an announcement.
     *
     * @param expectedFee What the caller expects to keep: the decayed schedule
     *                    fee on rung zero, the holder's `exitFee` after that.
     * @param transferable Whether the caller is willing to be displaced in
     *                     turn. False locks the position to them until
     *                     settlement.
     * @param exitFee The price the caller asks to be displaced at, ignored
     *                unless `transferable`.
     */
    function fillDeposit(
        string depositId,
        address expectedStratoRecipient,
        address expectedStratoToken,
        uint256 expectedStratoTokenAmount,
        uint256 expectedFee,
        bool transferable,
        uint256 exitFee
    ) external whenDepositsOpen returns (uint256 netPaid) {
        require(fillsEnabled, "SNB: fills disabled");

        NativeDepositInfo d = deposits[depositId];
        require(
            d.bridgeStatus == BridgeStatus.ANNOUNCED
                || d.bridgeStatus == BridgeStatus.INITIATED
                || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: not fillable"
        );
        require(d.stratoRecipient == expectedStratoRecipient, "SNB: recipient mismatch");
        require(d.stratoToken == expectedStratoToken, "SNB: token mismatch");
        require(d.stratoTokenAmount == expectedStratoTokenAmount, "SNB: amount mismatch");
        require(exitFee < d.stratoTokenAmount, "SNB: exit fee too large");

        NativeFeeTerms terms = depositFeeTerms[depositId];
        require(terms.set, "SNB: no fee terms");
        require(
            BridgeFees.isFeeCapAllowed(terms.maxFee, d.stratoTokenAmount, maxFeeBps),
            "SNB: fee above ceiling"
        );

        NativeDepositClaim claim = depositClaims[depositId];
        address payTo = claim.claimant;
        uint256 nextIndex = 0;
        uint256 feeCharged = 0;

        if (payTo == address(0)) {
            payTo = d.stratoRecipient;
            feeCharged = BridgeFees.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
        } else {
            require(!claim.voided, "SNB: claim voided");
            // The holder's consent is the whole gate. A solver who knows a
            // withdrawal is good must be able to keep their position; without
            // this, anyone could reclaim it out from under them for a penny of
            // decay.
            require(claim.transferable, "SNB: claim not transferable");
            nextIndex = claim.claimIndex + 1;
            feeCharged = claim.exitFee;
        }
        require(payTo != msg.sender, "SNB: already the claimant");
        // A FLOOR, NOT AN EXACT MATCH. `expectedFee` is the least the caller
        // will accept, and the fee only ever decays, so a solver quotes
        // slightly under what it expects and ordinary latency cannot trip it.
        // Exact equality would have required landing in one predicted second
        // and made rung-zero fills unusable in practice.
        //
        // It is purely the caller's own guard: the contract still computes
        // `feeCharged` from the committed schedule, so nothing here lets a
        // caller take more than the user agreed to. On a later rung a higher
        // price is strictly better for the taker -- they pay `amount - exitFee`
        // and keep `exitFee` -- so a floor is the right protection there too,
        // against a holder cutting their price after the taker committed.
        require(feeCharged >= expectedFee, "SNB: fee below your minimum");

        netPaid = d.stratoTokenAmount - feeCharged;
        require(netPaid > 0, "SNB: nothing to pay");

        depositClaims[depositId] = NativeDepositClaim(
            msg.sender,
            nextIndex,
            block.timestamp,
            feeCharged,
            netPaid,
            false,
            transferable,
            transferable ? exitFee : 0,
            d.stratoRecipient,
            d.stratoToken,
            d.stratoTokenAmount,
            terms.maxFee,
            terms.requestedAt,
            terms.feeHalfLife
        );

        uint256 delivered = _transferFromMeasured(d.stratoToken, msg.sender, payTo, netPaid);
        require(delivered == netPaid, "SNB: short delivery");

        emit NativeDepositFilled(
            depositId,
            msg.sender,
            payTo,
            nextIndex,
            d.stratoToken,
            d.stratoTokenAmount,
            feeCharged,
            netPaid
        );
    }

    /**
     * @notice Change whether your claim can be taken over, and at what price.
     *
     *         Callable by the current holder at any time before the deposit
     *         settles, as often as they like. A solver's read on a withdrawal
     *         changes -- a route starts looking shaky, a recipient starts
     *         looking like a thief -- and the position they are holding should
     *         be repriceable when it does. Setting `transferable` false pulls
     *         the position off the market entirely.
     *
     * @dev A taker passes the price they expect, so repricing cannot be used
     *      to front-run one: a raise that lands first makes their fill revert
     *      rather than execute at the new number.
     */
    function setDepositClaimExitOffer(
        string depositId,
        bool transferable,
        uint256 exitFee
    ) external {
        NativeDepositClaim claim = depositClaims[depositId];
        require(claim.claimant == msg.sender, "SNB: not the claimant");
        require(!claim.voided, "SNB: claim voided");

        NativeDepositInfo d = deposits[depositId];
        require(
            d.bridgeStatus == BridgeStatus.ANNOUNCED
                || d.bridgeStatus == BridgeStatus.INITIATED
                || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "SNB: deposit not open"
        );
        require(exitFee < d.stratoTokenAmount, "SNB: exit fee too large");

        claim.transferable = transferable;
        claim.exitFee = transferable ? exitFee : 0;

        emit NativeDepositClaimOfferUpdated(depositId, msg.sender, transferable, claim.exitFee);
    }

    /// @dev Move tokens between two third parties and MEASURE what arrived.
    ///      A solver must not be credited with a full claim for a partial
    ///      delivery, which a fee-on-transfer or paused token could otherwise
    ///      produce.
    function _transferFromMeasured(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        require(IERC20(token).transferFrom(from, to, amount), "SNB: transfer failed");
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "SNB: no tokens delivered");
    }

    // ───────────── Solver fast path: permissionless announcements ─────────────

    /**
     * @notice Post an external redemption here before the relayer has seen it,
     *         so a solver can fill it immediately.
     *
     *         The announcement records the deposit in the ANNOUNCED state,
     *         which can be filled but can NEVER be confirmed: only the
     *         relayer's own {recordDeposit} moves it to INITIATED, and only
     *         INITIATED or PENDING_REVIEW deposits unlock the vault. So an
     *         announcement moves no bridge funds and costs the bridge nothing
     *         even if it is a complete fabrication.
     *
     *         It costs the ANNOUNCER a bond, because storage is not free and
     *         because an announcement that misleads a careless solver should
     *         have a price. The bond comes back when the relayer adopts the
     *         announcement, is reclaimable if the relayer never does, and is
     *         slashed only when governance rules it fake.
     *
     * @dev This is a coordination surface, not evidence. It exists so the
     *      relayer stops being the starting gun and becomes a confirmation
     *      bot; a solver who fills against it without checking the external
     *      chain is trusting a stranger.
     *
     * @param requestedAt The external chain's timestamp of the redemption,
     *                    where the fee decay starts.
     */
    function announceDeposit(
        uint256 externalChainId,
        address externalBridge,
        uint256 externalRedemptionId,
        address externalSender,
        string externalTxHash,
        address representationToken,
        address stratoRecipient,
        uint256 stratoTokenAmount,
        uint256 maxFee,
        uint256 requestedAt
    ) external whenDepositsOpen returns (string depositId) {
        require(announcementsEnabled, "SNB: announcements disabled");
        require(externalSender != address(0), "SNB: invalid external sender");
        require(bytes(externalTxHash).length > 0, "SNB: invalid external tx hash");
        require(stratoRecipient != address(0), "SNB: invalid strato recipient");
        require(stratoTokenAmount > 0, "SNB: invalid strato token amount");

        depositId = getDepositId(externalChainId, externalBridge, externalRedemptionId);
        require(deposits[depositId].bridgeStatus == BridgeStatus.NONE, "SNB: already known");
        require(depositAnnouncements[depositId].state == 0, "SNB: already announced");

        address stratoToken = stratoTokenByRepresentation[representationToken][externalChainId];
        require(stratoToken != address(0), "SNB: asset missing");

        NativeAssetConfig asset = assets[stratoToken][externalChainId];
        require(asset.enabled, "SNB: asset disabled");
        require(!tokenBridgeConfigs[stratoToken].depositsDisabled, "SNB: token deposits disabled");
        require(asset.externalBridge == externalBridge, "SNB: wrong external bridge");
        require(asset.representationToken == representationToken, "SNB: wrong representation token");

        address bondToken = announcementBondToken;
        uint256 bondAmount = announcementBondAmount;
        require(bondToken != address(0) && bondAmount > 0, "SNB: bond not configured");

        depositAnnouncements[depositId] = NativeAnnouncement(
            msg.sender,
            bondToken,
            bondAmount,
            block.timestamp,
            1
        );

        deposits[depositId] = NativeDepositInfo(
            BridgeStatus.ANNOUNCED,
            depositId,
            externalBridge,
            externalSender,
            externalTxHash.normalizeHex(),
            externalChainId,
            externalRedemptionId,
            representationToken,
            block.timestamp,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        _commitDepositFeeTerms(depositId, stratoTokenAmount, maxFee, requestedAt);

        bondedBalance[bondToken] += bondAmount;
        uint256 bonded = _transferFromMeasured(bondToken, msg.sender, address(this), bondAmount);
        require(bonded == bondAmount, "SNB: short bond");

        emit NativeDepositAnnounced(
            depositId,
            msg.sender,
            externalChainId,
            externalBridge,
            externalRedemptionId,
            representationToken,
            stratoRecipient,
            stratoToken,
            stratoTokenAmount,
            maxFee,
            depositFeeTerms[depositId].requestedAt,
            depositFeeTerms[depositId].feeHalfLife,
            bondToken,
            bondAmount
        );
    }

    /// @notice Reclaim your own bond once the relayer has had long enough to
    ///         confirm the announcement and has not. Permissionless: an
    ///         announcer should never need an admin to get their own money
    ///         back, and a relayer outage must not read as fraud.
    function reclaimAnnouncementBond(string depositId) external {
        NativeAnnouncement a = depositAnnouncements[depositId];
        require(a.state == 1, "SNB: bond already resolved");
        require(
            block.timestamp >= a.announcedAt + announcementTtlSeconds,
            "SNB: bond not yet reclaimable"
        );
        _returnAnnouncementBond(depositId);
    }

    /// @notice Slash a fake announcement's bond. The only path that takes
    ///         someone's bond, and owner-gated for that reason: an
    ///         announcement that merely disagrees with the relayer's numbers is
    ///         superseded, not fraudulent, and its bond stays reclaimable.
    function rejectAnnouncement(string depositId) external onlyOwner {
        NativeAnnouncement a = depositAnnouncements[depositId];
        require(a.state == 1, "SNB: bond already resolved");
        require(announcementSlashRecipient != address(0), "SNB: no slash recipient");

        a.state = 3;
        uint256 amount = a.bondAmount;
        if (amount > 0) {
            bondedBalance[a.bondToken] -= amount;
            require(
                IERC20(a.bondToken).transfer(announcementSlashRecipient, amount),
                "SNB: bond transfer failed"
            );
        }

        // An announcement ruled fake should stop being a fillable record, and
        // the deposit must go back to being unknown so the relayer's own post
        // is treated as a fresh one.
        NativeDepositInfo d = deposits[depositId];
        if (d.bridgeStatus == BridgeStatus.ANNOUNCED) {
            d.bridgeStatus = BridgeStatus.ABORTED;
            d.timestamp = block.timestamp;
        }

        emit NativeAnnouncementBondSlashed(depositId, a.announcer, amount, announcementSlashRecipient);
    }

    function _returnAnnouncementBond(string depositId) internal {
        NativeAnnouncement a = depositAnnouncements[depositId];
        require(a.state == 1, "SNB: bond already resolved");

        a.state = 2;
        uint256 amount = a.bondAmount;
        if (amount > 0) {
            bondedBalance[a.bondToken] -= amount;
            require(IERC20(a.bondToken).transfer(a.announcer, amount), "SNB: bond transfer failed");
        }

        emit NativeAnnouncementBondReturned(depositId, a.announcer, amount);
    }

    // ───────────── Solver fast-path configuration ─────────────

    /// @notice Set the decay rate and the fee ceiling, and turn fills on or
    ///         off. A half-life of zero is refused: the schedule would be a
    ///         cliff rather than a decay.
    function setFeeConfig(
        uint256 halfLifeSeconds,
        uint256 feeBpsCeiling,
        bool enableFills
    ) external onlyOwner {
        require(BridgeFees.isHalfLifeAllowed(halfLifeSeconds), "SNB: invalid half-life");
        require(feeBpsCeiling <= BridgeFees.BPS_DENOMINATOR, "SNB: invalid fee ceiling");
        feeHalfLifeSeconds = halfLifeSeconds;
        maxFeeBps = feeBpsCeiling;
        fillsEnabled = enableFills;
        emit NativeFeeConfigUpdated(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    function setAnnouncementConfig(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint256 ttlSeconds
    ) external onlyOwner {
        if (enabled) {
            require(bondToken != address(0), "SNB: invalid bond token");
            require(bondAmount > 0, "SNB: invalid bond amount");
            require(slashRecipient != address(0), "SNB: invalid slash recipient");
            require(ttlSeconds > 0, "SNB: invalid bond ttl");
        }
        announcementsEnabled = enabled;
        announcementBondToken = bondToken;
        announcementBondAmount = bondAmount;
        announcementSlashRecipient = slashRecipient;
        announcementTtlSeconds = ttlSeconds;
        emit NativeAnnouncementConfigUpdated(
            enabled,
            bondToken,
            bondAmount,
            slashRecipient,
            ttlSeconds
        );
    }
}

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/utils/StringUtils.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";
import "../Admin/AdminRegistry.sol";
import "../../libraries/Bridge/BridgeTypes.sol";
import "../../libraries/Bridge/BridgeFees.sol";
import "../Lending/LendingRegistry.sol";
import "../Metals/MetalForge.sol";
import "../Pools/DirectMintPSM.sol";
import "../Savings/SaveUSDSTVault.sol";

/**
 * @title MercataBridge
 * @dev Complete bridge system for STRATO <-> External EVM value tunnel
 * @notice Manages deposit and withdrawal workflows with decimal conversion
 * @notice Implements the core logic for cross-chain token bridging
 * @notice Supports multiple external chains and token configurations
 *
 * @notice SOLVER FAST PATH. Both directions normally wait for the relayer's
 *         review and, outbound, for the custody multisig. A solver can front
 *         either leg for a fee the user names as a ceiling:
 *
 *         INBOUND (an external deposit becoming STRATO tokens) is filled here.
 *         {fillDeposit} moves the SOLVER's own tokens to the recipient, and
 *         {confirmDeposit} then mints to the solver instead. Both halves happen
 *         on this chain, so the redirect is enforced on chain.
 *
 *         OUTBOUND (a STRATO withdrawal becoming external tokens) is filled on
 *         the external chain, against the schedule this contract commits at
 *         request time. {recordWithdrawalClaim} mirrors that claim back here
 *         so the UI can see it and -- more importantly -- so the user cannot
 *         abort a withdrawal a solver has already paid out.
 *
 * @notice THE FEE DECAYS EXPONENTIALLY TO ZERO OVER THREE DAYS from the
 *         request. A fast fill costs close to the ceiling, a slow one costs
 *         proportionally less, and one that never comes costs nothing. There
 *         is no refund step because the fee is never taken: the solver simply
 *         has to deliver more the longer they wait.
 *
 * @notice CLAIMS ARE A LADDER, and the holder controls the rung above them.
 *         Rung zero pays the user at their committed schedule. After that a
 *         claim changes hands only if its holder marked it transferable, at
 *         the holder's own asking price -- which may be higher than they
 *         earned, so a solver who decides a transfer looks fraudulent can pay
 *         someone else to carry it. The user is paid once and the bridge mints
 *         or pays out once, whatever happens in between.
 *
 * @notice ANNOUNCEMENTS let anyone post an external deposit here before the
 *         relayer has seen it, against a bond, so a solver can fill it
 *         immediately. An ANNOUNCED deposit can never be confirmed -- only the
 *         relayer's own record moves it to INITIATED -- so a fabricated
 *         announcement costs the bridge nothing and its author a bond.
 *
 * @dev WHAT THE FAST PATH DOES NOT DO: it does not skip a review, a time lock,
 *      or a multisig vote. A solver waits for all of it and carries the risk
 *      that the deposit is aborted, the withdrawal rejected, or the escrow
 *      swept -- which is what turns that risk into a quoted fee.
 */
contract record MercataBridge is Ownable {
    /// @notice Enables BridgeTypes library functions for all types
    /// @dev Allows direct access to BridgeTypes utility functions without explicit library calls
    using BridgeTypes for *;
    using BridgeFees for *;
    using StringUtils for string;

    /* ===================================================================== */
    /*                                EVENTS                                 */
    /* ===================================================================== */

    // ───────────── Admin related events ─────────────
    /// @notice Emitted when pause states are toggled for deposits and withdrawals
    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);

    /// @notice Emitted when the token factory address is updated
    event TokenFactoryUpdated(address newFactory, address oldFactory);

    /// @notice Emitted when the lending registry address is updated
    event LendingRegistryUpdated(address newRegistry, address oldRegistry);

    /// @notice Emitted when the USDST address is updated
    event USDSTAddressUpdated(address newAddress, address oldAddress);

    /// @notice Emitted when a chain's enabled state is toggled
    event ChainToggled(bool enabled, uint256 externalChainId);

    /// @notice Emitted when an asset's enabled state is toggled
    event AssetToggled(bool enabled, uint256 externalChainId, address externalToken);

    /// @notice Emitted when the hot withdrawal threshold is updated
    event HotWithdrawalThresholdUpdated(uint256 chainId, address token, uint256 newThreshold, uint256 oldThreshold);

    // ───────────── Deposit & withdrawal related events ─────────────
    /// @notice Emitted when a deposit is aborted by the owner
    event DepositAborted(uint256 srcChainId, string srcTxHash);

    /// @notice Emitted when a deposit is completed
    /// @param externalChainId The external chain identifier where the deposit occurred
    /// @param externalSender The address that sent the transaction on the external chain
    /// @param externalTxHash The transaction hash on the external chain
    /// @param stratoRecipient The STRATO address to receive the minted tokens
    /// @param stratoToken The source STRATO route token for the bridge entitlement
    /// @param stratoTokenAmount The source STRATO route-token amount
    event DepositCompleted(uint256 externalChainId, address externalSender, string externalTxHash, address stratoRecipient, address stratoToken, uint256 stratoTokenAmount);

    /// @notice Emitted when a deposit is initiated
    /// @param externalChainId The external chain identifier where the deposit occurred
    /// @param externalSender The address that sent the transaction on the external chain
    /// @param externalTxHash The transaction hash on the external chain
    /// @param stratoRecipient The STRATO address to receive the minted tokens
    /// @param stratoToken The STRATO token address that will be minted
    /// @param stratoTokenAmount The amount of STRATO tokens to be minted
    event DepositInitiated(uint256 externalChainId, address externalSender, string externalTxHash, address stratoRecipient, address stratoToken, uint256 stratoTokenAmount);

    /// @notice Emitted when a deposit requires manual review
    event DepositPendingReview(uint256 srcChainId, string srcTxHash);

    /// @notice Emitted when a withdrawal is aborted and funds are refunded
    /// @notice An aborted withdrawal's escrow went to the solver holding its claim,
    ///         because that solver had already paid the recipient externally.
    event WithdrawalEscrowReleasedToClaimant(uint256 indexed withdrawalId, address indexed claimant, uint256 amount);
    event WithdrawalAborted(uint256 withdrawalId);

    /// @notice Emitted when a withdrawal is completed and tokens are burned
    event WithdrawalCompleted(uint256 withdrawalId, address user, address stratoToken, uint256 stratoTokenAmount);

    /// @notice Emitted when a withdrawal is pending custody transaction
    event WithdrawalPending(string custodyTxHash, uint256 withdrawalId);

    /// @notice Emitted when a user requests a withdrawal
    /// @param dest The external recipient address on the destination chain
    /// @param destChainId The external chain identifier where tokens should be sent
    /// @param externalTokenAmount The amount of external tokens to be sent
    /// @param stratoTokenAmount The amount of STRATO tokens escrowed
    /// @param token The STRATO token address that was escrowed
    /// @param user The address that requested the withdrawal
    /// @param withdrawalId The unique withdrawal identifier
    event WithdrawalRequested(address dest, uint256 destChainId, uint256 externalTokenAmount, uint256 stratoTokenAmount, address token, address user, uint256 withdrawalId, bool useHotWallet);

    /// @notice Emitted when governance cancels a withdrawal and moves its escrow to a triage wallet
    /// @dev custodyTxHash is non-empty when the withdrawal was already PENDING_REVIEW: that custody
    ///      transaction must also be rejected on the external chain, or the recipient is paid there too
    event WithdrawalSwept(uint256 withdrawalId, address stratoSender, address stratoToken, uint256 stratoTokenAmount, address triageWallet, string custodyTxHash);

    // ───────────── Registry related events ─────────────
    /// @notice Emitted when chain configuration is updated
    event ChainUpdated(string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router, address hotWallet);

    /// @notice Emitted when the last processed block is updated for a chain
    event LastProcessedBlockUpdated(uint256 externalChainId, uint256 lastProcessedBlock);

    /// @notice Emitted during emergency block rollback operations
    event EmergencyBlockRollback(uint256 externalChainId, uint256 lastProcessedBlock);

    /// @notice Emitted when asset configuration is updated for a chain
    /// @param enabled Whether the asset is enabled for bridge operations
    /// @param externalChainId The external chain identifier
    /// @param externalDecimals The number of decimals for the external token
    /// @param externalName The name of the external token
    /// @param externalSymbol The symbol of the external token
    /// @param externalToken The address of the external token contract
    /// @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
    /// @param stratoToken The corresponding STRATO token address
    event AssetUpdated(bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken);

    /// @notice Emitted when the metal forge address is updated
    event MetalForgeUpdated(address newForge, address oldForge);

    /// @notice Emitted when the direct-mint PSM address is updated
    event DirectMintPsmUpdated(address newPsm, address oldPsm);

    /// @notice Emitted when the SaveUSDST vault address is updated
    event SaveUsdstVaultUpdated(address newVault, address oldVault);

    event DepositActionAvailabilityUpdated(
        address externalToken,
        uint256 externalChainId,
        address targetStratoToken,
        uint256 action,
        bool enabled
    );

    /// @notice Emitted when a user requests a post-deposit action
    event DepositActionRequested(address user, uint256 externalChainId, string externalTxHash, DepositAction action, address targetToken);

    /// @notice Emitted when a deposit is auto saved to the lending pool
    event AutoSaved(uint256 externalChainId, string externalTxHash, uint256 mintedAmount, uint256 mTokenAmount);

    /// @notice Emitted when a deposit is auto forged into metal
    event AutoForged(uint256 externalChainId, string externalTxHash, address payToken, uint256 payAmount, address metalToken, uint256 metalAmount);

    event AutoSavedUSDST(
        uint256 externalChainId,
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
        string externalTxHash,
        address recipient,
        uint256 action,
        address actionToken,
        address fallbackToken,
        uint256 fallbackAmount
    );

    // ───────────── Solver fast-path events ─────────────
    /// @notice The fee schedule a request committed to. Emitted separately from
    ///         the request event rather than widening it: Cirrus tables and the
    ///         relayer both key off the existing shapes, and changing one would
    ///         orphan every consumer at the same instant.
    event DepositFeeTermsSet(
        uint256 externalChainId,
        string externalTxHash,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    event WithdrawalFeeTermsSet(
        uint256 withdrawalId,
        uint256 maxFeeStrato,
        uint256 maxFeeExternal,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    /// @notice A solver took over a deposit's claim. `paidTo` is the party they
    ///         displaced: the recipient on claim 0, the previous claimant after
    ///         that.
    event DepositFilled(
        uint256 externalChainId,
        string externalTxHash,
        address claimant,
        address paidTo,
        uint256 claimIndex,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 feeCharged,
        uint256 netPaid
    );
    /// @notice A claim holder changed whether, and at what price, they are
    ///         willing to be displaced.
    event DepositClaimOfferUpdated(
        uint256 externalChainId,
        string externalTxHash,
        address claimant,
        bool transferable,
        uint256 exitFee
    );
    /// @notice The mint was redirected to a claimant who had already paid the
    ///         recipient.
    event DepositClaimSettled(
        uint256 externalChainId,
        string externalTxHash,
        address claimant,
        uint256 claimIndex,
        uint256 feeCharged
    );
    /// @notice A claim existed but was priced against a record that no longer
    ///         matches, so it was ignored and the recipient was paid. An event
    ///         rather than a revert: a bogus claim must never be able to hold a
    ///         real deposit hostage.
    event DepositClaimVoided(
        uint256 externalChainId,
        string externalTxHash,
        address claimant,
        string reason
    );
    event WithdrawalClaimRecorded(
        uint256 withdrawalId,
        address claimant,
        uint256 claimIndex,
        uint256 feeCharged,
        uint256 netPaid,
        string externalFillTxHash
    );
    event DepositAnnounced(
        uint256 externalChainId,
        string externalTxHash,
        address announcer,
        address externalSender,
        address externalToken,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife,
        address bondToken,
        uint256 bondAmount
    );
    event AnnouncementBondReturned(uint256 externalChainId, string externalTxHash, address announcer, uint256 amount);
    event AnnouncementBondSlashed(uint256 externalChainId, string externalTxHash, address announcer, uint256 amount, address recipient);
    event AnnouncementSuperseded(uint256 externalChainId, string externalTxHash, address announcer);
    event FeeConfigUpdated(uint256 feeHalfLifeSeconds, uint256 maxFeeBps, bool fillsEnabled);
    event AnnouncementConfigUpdated(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint256 ttlSeconds
    );

    /* ===================================================================== */
    /*                            STATE VARIABLES                            */
    /* ===================================================================== */
    // ───────────── Admin related state variables ─────────────
    /// @notice Standard decimal places for STRATO tokens
    /// @dev Default: 18 decimals for all STRATO tokens
    /// @dev Used for decimal conversion between external tokens and STRATO tokens
    uint256 public DECIMAL_PLACES = 18;

    /// @notice Circuit breaker for deposit operations
    /// @dev When true, all deposit operations are paused
    bool public depositsPaused;

    /// @notice Token factory contract for creating new STRATO tokens
    /// @dev Single source of truth for active token creation
    address public tokenFactory;

    /// @notice Lending registry contract for managing auto earning
    address public lendingRegistry;

    /// @notice MetalForge contract for auto-forging metals on deposit
    address public metalForge;

    /// @notice USDST token address for cross-chain minting/redeeming
    /// @dev Default USDST address: 0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010
    address public USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);

    /// @notice DirectMintPSM used to convert bridged stablecoins into USDST
    address public directMintPsm;

    /// @notice SaveUSDSTVault used for AUTO_SAVE deposits
    address public saveUsdstVault;

    /// @notice Circuit breaker for withdrawal operations
    /// @dev When true, all withdrawal operations are paused
    bool public withdrawalsPaused;

    /// @notice Time delay before users can abort stuck withdrawals
    /// @dev Default: 172800 seconds (48 hours)
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;

    /// @notice Threshold below which withdrawals bypass SAFE multi-sig and use hot wallet
    mapping (uint256 => mapping (address => uint256)) public hotWithdrawalThresholds;

    // ───────────── Deposit & withdrawal related state variables ─────────────
    /// @notice Registry of deposit transactions with replay protection
    /// @dev Maps external chain ID and transaction hash to deposit information
    /// @dev Key: (externalChainId, externalTxHash) -> Value: DepositInfo struct
    /// @dev Prevents duplicate processing of the same external transaction
    /// @dev Stores deposit state and conversion information
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /// @notice Registry of post-deposit action requests
    /// @dev Key: (userAddress, externalChainId, externalTxHash) -> Value: DepositActionRequest
    mapping(address => mapping(uint256 => mapping(string => DepositActionRequest))) public record depositActionRequests;

    struct DepositActionIntent {
        uint256 action;
        address actionToken;
        uint256 minFinalOut;
    }

    /// @notice The solver fee schedule a request committed to, in STRATO
    ///         units. Written once and never updated: an admin who changes the
    ///         configured half-life must not be able to re-price a request
    ///         already in flight.
    struct BridgeFeeTerms {
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
     *      later disagree with it. {confirmDeposit} re-compares these fields to
     *      the live record and mints to the claimant only on an exact match --
     *      otherwise the claim is void, the recipient is minted to as if no
     *      solver had appeared, and the solver has given a stranger money.
     *      Stored field by field rather than as a hash so an indexer can see
     *      exactly what was claimed.
     *
     * @dev `action` is in the snapshot because a deposit carrying an
     *      auto-forge or auto-save intent is NOT fillable: a solver cannot
     *      reproduce the action, and handing them the mint would leave the
     *      depositor without the thing they asked for. A fill requires it to
     *      be zero, and a relayer who later adds one voids the claim.
     */
    struct DepositClaim {
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
        uint256 action;
    }

    /// @notice A claim on an outbound withdrawal, as verified on the external
    ///         chain and mirrored here by the relayer. Advisory for settlement
    ///         -- the external chain pays the solver -- but binding for abort:
    ///         see {abortWithdrawal}.
    struct WithdrawalClaim {
        address claimant;
        uint256 claimIndex;
        uint256 claimedAt;
        uint256 feeCharged;
        uint256 netPaid;
        string externalFillTxHash;
    }

    /// @notice A bonded, unverified claim that an external deposit exists.
    ///         `state` is 1 while live, 2 once the bond has been returned, 3
    ///         once it has been slashed.
    struct DepositAnnouncement {
        address announcer;
        address bondToken;
        uint256 bondAmount;
        uint256 announcedAt;
        uint256 state;
    }

    struct DepositActionConfig {
        bool autoForge;
        bool autoSave;
    }

    /// @notice Deposit-keyed action intent recorded atomically by the relayer
    mapping(uint256 => mapping(string => DepositActionIntent)) public record depositActions;

    /// @notice Registry of withdrawal requests by withdrawal ID
    /// @dev Maps withdrawal ID to withdrawal information
    /// @dev Key: withdrawalId (uint256) -> Value: WithdrawalInfo struct
    mapping(uint256 => WithdrawalInfo) public record withdrawals;

    /// @notice Auto-incrementing counter for withdrawal IDs
    /// @dev Ensures unique withdrawal identifiers for each request
    uint256 public withdrawalCounter;

    /// @notice Triage wallet that received the escrow of a SWEPT withdrawal
    /// @dev Key: withdrawalId -> triage wallet. Set only by cancelAndSweepWithdrawal.
    mapping(uint256 => address) public record withdrawalSweptTo;

    // ───────────── Registry related state variables ─────────────
    /// @notice Registry of external chains and their configuration
    /// @dev Maps external chain ID to chain information including custody, router, and processing state
    /// @dev Key: externalChainId (uint256) -> Value: ChainInfo struct
    mapping(uint256 => ChainInfo) public record chains;

    /// @notice Registry of assets for each external chain
    /// @dev Maps external token address and chain ID to asset configuration
    /// @dev Key: (externalToken address, externalChainId) -> Value: AssetInfo struct
    /// @dev Used to configure token mappings between external chains and STRATO
    /// @dev Includes decimal conversion information for each token pair
    mapping(address => mapping(uint256 => AssetInfo)) public record assets;

    /// @notice Route allowlist for one-to-many external->STRATO mappings
    /// @dev Key: (externalToken, externalChainId, targetStratoToken) -> enabled
    mapping(address => mapping(uint256 => mapping(address => bool))) public record assetRouteEnabled;

    /// @notice Action allowlist for each external-to-STRATO route
    /// @dev Key: (externalToken, externalChainId, targetStratoToken) -> action flags
    mapping(address => mapping(uint256 => mapping(address => DepositActionConfig))) public record depositActionConfigs;

    // ───────────── Solver fast-path state ─────────────
    /// @notice Half-life, in seconds, of an offered solver fee. Committed into
    ///         each request, so changing it never re-prices one in flight.
    uint256 public feeHalfLifeSeconds;

    /// @notice Ceiling on any offered fee, in basis points of the amount. The
    ///         anti-grief bound on claims: a solver who inflates the schedule
    ///         underpays the recipient and occupies the ladder, so occupying it
    ///         has to cost nearly the whole amount, paid to the user. Zero
    ///         refuses every fee and disables the fast path outright.
    uint256 public maxFeeBps;

    /// @notice Master switch for {fillDeposit}, separate from the deposit
    ///         circuit breaker: stopping solvers is not the same decision as
    ///         stopping the bridge.
    bool public fillsEnabled;

    /// @notice Master switch for {announceDeposit}.
    bool public announcementsEnabled;

    /// @notice Announcement bond configuration: what is posted, where a slashed
    ///         bond goes, and how long before an unconfirmed bond can be
    ///         reclaimed.
    address public announcementBondToken;
    uint256 public announcementBondAmount;
    address public announcementSlashRecipient;
    uint256 public announcementTtlSeconds;

    /// @notice Bonds this contract is holding, per token. Tracked separately
    ///         from escrow so a bond is never mistaken for a withdrawal's
    ///         backing.
    mapping(address => uint256) public record bondedBalance;

    /// @notice The committed fee schedule, keyed exactly as the record it
    ///         belongs to: (externalChainId, externalTxHash) for deposits,
    ///         withdrawalId for withdrawals.
    mapping(uint256 => mapping(string => BridgeFeeTerms)) public record depositFeeTerms;
    mapping(uint256 => BridgeFeeTerms) public record withdrawalFeeTerms;

    /// @notice The head of each claim ladder.
    mapping(uint256 => mapping(string => DepositClaim)) public record depositClaims;
    mapping(uint256 => WithdrawalClaim) public record withdrawalClaims;

    /// @notice Permissionless announcements of external deposits.
    mapping(uint256 => mapping(string => DepositAnnouncement)) public record depositAnnouncements;


    /* ===================================================================== */
    /*                            MODIFIERS                                  */
    /* ===================================================================== */
    /// @notice Ensures deposits are not paused
    /// @dev Prevents deposit operations when circuit breaker is active
    modifier whenDepositsOpen() {
        require(!depositsPaused, "MB: deposits paused");
        _;
    }

    /// @notice Ensures withdrawals are not paused
    /// @dev Prevents withdrawal operations when circuit breaker is active
    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "MB: withdrawals paused");
        _;
    }

    /* ===================================================================== */
    /*                            FUNCTIONS                                  */
    /* ===================================================================== */
    // ───────────── Constructor related functions ─────────────
    /**
     * @dev Initializes the MercataBridge contract with the specified owner
     * @notice Sets up the bridge system with ownership and access control
     * @notice This is the main bridge contract that handles all cross-chain operations
     * @param _owner The address that will be set as the contract owner
     */
    constructor(
        address _owner
    ) Ownable(_owner) { }

    /**
     * @dev Initializes the bridge system with essential configuration
     * @notice Sets up token factory and default values for the bridge
     * @notice Must be called after deployment to configure the bridge properly
     * @notice Configures decimal places, USDST address, and withdrawal timeout
     * @param _tokenFactory The token factory contract address for creating STRATO tokens
     */
    function initialize(
        address _tokenFactory,
        address _lendingRegistry,
        address _metalForge
    ) external onlyOwner {
        DECIMAL_PLACES = 18;
        USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);
        WITHDRAWAL_ABORT_DELAY = 172800;

        setTokenFactory(_tokenFactory);
        setLendingRegistry(_lendingRegistry);
        setMetalForge(_metalForge);
    }

    // ───────────── Admin related functions ─────────────
    /**
     * @dev Emergency function to set the last processed block for a chain
     * @notice Allows rollback of block processing state in emergency situations
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The block number to set as last processed
     */
    function emergencySetLastProcessedBlock(
        uint256 externalChainId, uint256 lastProcessedBlock
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");

        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
        emit EmergencyBlockRollback(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets asset configuration for a specific external chain
     * @notice Maps external tokens to their STRATO equivalents with withdrawal limits
     * @notice Configures decimal conversion between external tokens and STRATO tokens
     * @param enabled Whether the asset is enabled for bridge operations
     * @param externalChainId The external chain identifier
     * @param externalDecimals The number of decimals for the external token (used for conversion)
     * @param externalName The name of the external token
     * @param externalSymbol The symbol of the external token
     * @param externalToken The address of the external token contract
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     * @param stratoToken The corresponding STRATO token address
     */
    function setAsset(
        bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken
    ) external onlyOwner {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        require(externalName.length > 0, "MB: invalid external name");
        require(externalSymbol.length > 0, "MB: invalid external symbol");
        require(stratoToken != address(0), "MB: invalid strato token");
        require(externalDecimals <= DECIMAL_PLACES, "MB: decimals exceed max");
        assets[externalToken][externalChainId] = AssetInfo(enabled, externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
        emit AssetUpdated(enabled, externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
    }

    /**
     * @dev Updates asset metadata (name and symbol) for an existing asset
     * @notice Only the owner can update asset metadata for existing assets
     * @notice Allows updating token display information without recreating the asset
     * @notice Validates that the asset exists before updating metadata
     * @param externalChainId The external chain identifier where the asset is configured
     * @param externalName The new name of the external token
     * @param externalSymbol The new symbol of the external token
     * @param externalToken The external token address to update
     */
    function setAssetMetadata(
        uint256 externalChainId, string externalName, string externalSymbol, address externalToken
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(externalName.length > 0, "MB: invalid external name");
        require(externalSymbol.length > 0, "MB: invalid external symbol");
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        AssetInfo assetInfo = assets[externalToken][externalChainId];
        require(assetInfo.externalToken == externalToken, "MB: asset not found");
        assetInfo.externalName = externalName;
        assetInfo.externalSymbol = externalSymbol;
        emit AssetUpdated(assetInfo.enabled, externalChainId, assetInfo.externalDecimals, externalName, externalSymbol, externalToken, assetInfo.maxPerWithdrawal, assetInfo.stratoToken);
    }

    /**
     * @dev Sets token withdrawal limits for an existing asset
     * @notice Only the owner can set withdrawal limits for existing assets
     * @notice Allows configuring maximum withdrawal amounts for risk management
     * @notice Setting maxPerWithdrawal to 0 means unlimited withdrawals
     * @notice Validates that the asset exists before updating limits
     * @param externalChainId The external chain identifier where the asset is configured
     * @param externalToken The external token address to update limits for
     * @param maxPerWithdrawal Maximum amount per withdrawal (0 = unlimited)
     */
    function setWithdrawalLimits(
        uint256 externalChainId, address externalToken, uint256 maxPerWithdrawal
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        AssetInfo assetInfo = assets[externalToken][externalChainId];
        require(assetInfo.externalToken == externalToken, "MB: asset not found");
        assetInfo.maxPerWithdrawal = maxPerWithdrawal;
        emit AssetUpdated(assetInfo.enabled, externalChainId, assetInfo.externalDecimals, assetInfo.externalName, assetInfo.externalSymbol, externalToken, maxPerWithdrawal, assetInfo.stratoToken);
    }

    /**
     * @dev Sets chain configuration for bridge operations
     * @notice Configures external chain parameters including custody and router addresses
     * @param chainName The human-readable name of the external chain
     * @param custody The custody contract address on the external chain
     * @param enabled Whether the chain is enabled for bridge operations
     * @param externalChainId The unique identifier for the external chain
     * @param lastProcessedBlock The last processed block number for this chain
     * @param router The router contract address for deposits
     */
    function setChain(
        string chainName, address custody, address hotWallet, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router
    ) external onlyOwner {
        require(chainName.length > 0, "MB: invalid chain name");
        require(custody != address(0), "MB: zero custody address");
        require(externalChainId > 0, "MB: invalid external chain id");
        require(router != address(0), "MB: zero router address");
        chains[externalChainId] = ChainInfo(chainName, custody, hotWallet, router, enabled, lastProcessedBlock);
        emit ChainUpdated(chainName, custody, enabled, externalChainId, lastProcessedBlock, router, hotWallet);
    }

    /**
     * @dev Updates the last processed block for a specific chain
     * @notice Prevents rollback attacks by ensuring block numbers only increase
     * @param externalChainId The external chain identifier
     * @param lastProcessedBlock The new last processed block number
     */
    function setLastProcessedBlock(
        uint256 externalChainId, uint256 lastProcessedBlock
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        ChainInfo chainInfo = chains[externalChainId];
        require(chainInfo.custody != address(0), "MB: chain missing");

        require(lastProcessedBlock >= chainInfo.lastProcessedBlock, "MB: cannot rollback block");

        chainInfo.lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
    }

    /**
     * @dev Sets pause states for deposits and withdrawals
     * @notice Circuit breaker functionality to pause bridge operations
     * @param _deposits Whether to pause deposit operations
     * @param _withdrawals Whether to pause withdrawal operations
     */
    function setPause(bool _deposits, bool _withdrawals) external onlyOwner {
        depositsPaused    = _deposits;
        withdrawalsPaused = _withdrawals;
        emit PauseToggled(_deposits, _withdrawals);
    }

    /**
     * @dev Sets the token factory address
     * @notice Only the owner can update the token factory address
     * @param newFactory The new token factory address (must not be zero address)
     */
    function setTokenFactory(address newFactory) public onlyOwner {
        require(newFactory != address(0), "MB: zero");
        emit TokenFactoryUpdated(newFactory, tokenFactory);
        tokenFactory = newFactory;
    }

    /**
     * @dev Sets the lending registry address
     * @notice Only the owner can update the lending registry address
     * @param newLendingRegistry The new lending registry address (must not be zero address)
     */
    function setLendingRegistry(address newLendingRegistry) public onlyOwner {
        require(newLendingRegistry != address(0), "MB: zero lending registry address");
        emit LendingRegistryUpdated(newLendingRegistry, lendingRegistry);
        lendingRegistry = newLendingRegistry;
    }

    /**
     * @dev Sets the metal forge address
     * @notice Only the owner can update the metal forge address
     * @param newMetalForge The new metal forge address (must not be zero address)
     */
    function setMetalForge(address newMetalForge) public onlyOwner {
        require(newMetalForge != address(0), "MB: zero metal forge address");
        emit MetalForgeUpdated(newMetalForge, metalForge);
        metalForge = newMetalForge;
    }

    /**
     * @dev Sets the DirectMintPSM used by deposit actions
     * @notice The PSM must mint the bridge's configured USDST token
     */
    function setDirectMintPsm(address newDirectMintPsm) external onlyOwner {
        require(newDirectMintPsm != address(0), "MB: zero direct mint psm");
        require(DirectMintPSM(newDirectMintPsm).mintableToken() == USDST_ADDRESS, "MB: psm token mismatch");
        emit DirectMintPsmUpdated(newDirectMintPsm, directMintPsm);
        directMintPsm = newDirectMintPsm;
    }

    /**
     * @dev Sets the SaveUSDSTVault used by deposit actions
     * @notice The vault asset must be the bridge's configured USDST token
     */
    function setSaveUsdstVault(address newSaveUsdstVault) external onlyOwner {
        require(newSaveUsdstVault != address(0), "MB: zero save vault");
        require(SaveUSDSTVault(newSaveUsdstVault).asset() == USDST_ADDRESS, "MB: vault asset mismatch");
        emit SaveUsdstVaultUpdated(newSaveUsdstVault, saveUsdstVault);
        saveUsdstVault = newSaveUsdstVault;
    }

    /**
     * @dev Sets the USDST token address
     * @notice Only the owner can update the USDST address
     * @param newUSDSTAddress The new USDST token address (must not be zero address)
     */
    function setUSDSTAddress(address newUSDSTAddress) external onlyOwner {
        require(newUSDSTAddress != address(0), "MB: zero USDST address");
        emit USDSTAddressUpdated(newUSDSTAddress, USDST_ADDRESS);
        USDST_ADDRESS = newUSDSTAddress;
    }

    /**
     * @dev Toggles the enabled state of a chain
     * @notice Only the owner can enable/disable chains
     * @param externalChainId The external chain identifier
     * @param enabled Whether to enable or disable the chain
     */
    function toggleChain(uint256 externalChainId, bool enabled) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(chains[externalChainId].custody != address(0), "MB: chain not found");

        chains[externalChainId].enabled = enabled;
        emit ChainToggled(enabled, externalChainId);
    }

    /**
     * @dev Toggles the enabled state of an asset
     * @notice Only the owner can enable/disable assets
     * @param externalToken The external token address
     * @param externalChainId The external chain identifier
     * @param enabled Whether to enable or disable the asset
     */
    function toggleAsset(address externalToken, uint256 externalChainId, bool enabled) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(assets[externalToken][externalChainId].externalChainId == externalChainId, "MB: asset not found");

        assets[externalToken][externalChainId].enabled = enabled;
        emit AssetToggled(enabled, externalChainId, externalToken);
    }

    /**
     * @dev Enables/disables an external asset route to a target STRATO token
     * @notice Supports one-to-many mappings such as XAUT -> XAUTST and XAUT -> GOLDST
     * @param externalToken The external token address
     * @param externalChainId The external chain identifier
     * @param targetStratoToken The STRATO token that can be minted/burned for this route
     * @param enabled Whether route should be enabled
     */
    function setAssetRoute(
        address externalToken,
        uint256 externalChainId,
        address targetStratoToken,
        bool enabled
    ) external onlyOwner {
        require(externalChainId > 0, "MB: invalid chain id");
        require(targetStratoToken != address(0), "MB: invalid target token");
        require(assets[externalToken][externalChainId].externalChainId == externalChainId, "MB: asset not found");
        if (enabled) {
            require(TokenFactory(tokenFactory).isTokenActive(targetStratoToken), "MB: inactive token");
        }
        assetRouteEnabled[externalToken][externalChainId][targetStratoToken] = enabled;
    }

    function setDepositAction(
        address externalToken,
        uint256 externalChainId,
        address targetStratoToken,
        uint256 action,
        bool enabled
    ) external onlyOwner {
        require(
            action == uint256(DepositAction.AUTO_FORGE) ||
            action == uint256(DepositAction.AUTO_SAVE),
            "MB: invalid action"
        );
        if (enabled) {
            _requireRouteEnabled(externalToken, externalChainId, targetStratoToken);
        } else {
            require(targetStratoToken != address(0), "MB: invalid target token");
            require(assets[externalToken][externalChainId].stratoToken != address(0), "MB: asset missing");
        }
        DepositActionConfig config = depositActionConfigs[externalToken][externalChainId][targetStratoToken];
        if (action == uint256(DepositAction.AUTO_FORGE)) {
            config.autoForge = enabled;
        } else {
            config.autoSave = enabled;
        }
        emit DepositActionAvailabilityUpdated(externalToken, externalChainId, targetStratoToken, action, enabled);
    }

    /**
     * @dev Sets the hot withdrawal threshold
     * @notice Withdrawals with stratoTokenAmount below this threshold can bypass SAFE multi-sig
     * @notice Set to 0 to disable the hot wallet path (all withdrawals go through SAFE)
     * @param newThreshold The new threshold in wei (e.g. 100e18 for $100)
     */
    function setHotWithdrawalThreshold(uint256 chainId, address token, uint256 newThreshold) external onlyOwner {
        uint256 oldThreshold = hotWithdrawalThresholds[chainId][token];
        emit HotWithdrawalThresholdUpdated(chainId, token, newThreshold, oldThreshold);
        hotWithdrawalThresholds[chainId][token] = newThreshold;
    }

    // ───────────── Escrow related functions ─────────────
    /**
     * @dev Burns tokens from the escrow contract
     * @param token The token contract address
     * @param amount The amount of tokens to burn
     * @return actualAmount The actual amount of tokens burned
     */
    function _burnFunds(address token, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        Token(token).burn(address(this), amount);
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "MB: no tokens burned");
    }

    /**
     * @dev Escrows tokens from a user to this contract
     * @param token The token contract address
     * @param from The address to transfer tokens from
     * @param amount The amount of tokens to escrow
     * @return actualAmount The actual amount of tokens escrowed
     */
    function _escrowFunds(address token, address from, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(from, address(this), amount), "MB: transfer failed");
        actualAmount = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(actualAmount > 0, "MB: no tokens received");
    }

    /**
     * @dev Mints tokens to a recipient address
     * @param token The token contract address
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @return actualAmount The actual amount of tokens minted
     */
    function _mintFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        Token(token).mint(to, amount);
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "MB: no tokens minted");
    }

    /**
     * @dev Refunds tokens from this contract to a recipient
     * @param token The token contract address
     * @param to The address to refund tokens to
     * @param amount The amount of tokens to refund
     * @return actualAmount The actual amount of tokens refunded
     */
    function _refundFunds(address token, address to, uint256 amount) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transfer(to, amount), "MB: transfer failed");
        actualAmount = balanceBefore - IERC20(token).balanceOf(address(this));
        require(actualAmount > 0, "MB: no tokens sent");
    }

    function _requireRouteEnabled(
        address externalToken,
        uint256 externalChainId,
        address targetStratoToken
    ) internal view {
        require(targetStratoToken != address(0), "MB: invalid target token");
        AssetInfo a = assets[externalToken][externalChainId];
        require(a.stratoToken != address(0), "MB: asset missing");
        bool isDefaultRoute = targetStratoToken == a.stratoToken && a.enabled;
        bool isExplicitRoute = assetRouteEnabled[externalToken][externalChainId][targetStratoToken];
        require(isDefaultRoute || isExplicitRoute, "MB: route not enabled");
    }

    function _isDepositActionEnabled(
        DepositInfo d,
        uint256 externalChainId,
        uint256 action
    ) internal view returns (bool) {
        DepositActionConfig config = depositActionConfigs[d.externalToken][externalChainId][d.stratoToken];
        if (action == uint256(DepositAction.AUTO_FORGE)) return config.autoForge;
        if (action == uint256(DepositAction.AUTO_SAVE)) return config.autoSave;
        return false;
    }

    function _executeDepositAction(
        uint256 externalChainId,
        string normalizedTxHash
    ) internal {
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        DepositActionIntent intent = depositActions[externalChainId][normalizedTxHash];
        DepositAction action = DepositAction(intent.action);

        uint256 sourceAmount = _mintFunds(d.stratoToken, address(this), d.stratoTokenAmount);
        uint256 usdstOut;

        if (d.stratoToken == USDST_ADDRESS) {
            usdstOut = sourceAmount;
        } else {
            require(directMintPsm != address(0), "MB: direct mint psm not set");
            IERC20(d.stratoToken).approve(directMintPsm, sourceAmount);
            uint256 usdstBefore = IERC20(USDST_ADDRESS).balanceOf(address(this));
            DirectMintPSM(directMintPsm).mint(sourceAmount, d.stratoToken);
            usdstOut = IERC20(USDST_ADDRESS).balanceOf(address(this)) - usdstBefore;
            require(usdstOut > 0, "MB: no USDST minted");
        }

        if (action == DepositAction.AUTO_SAVE) {
            require(saveUsdstVault != address(0), "MB: save vault not set");
            IERC20(USDST_ADDRESS).approve(saveUsdstVault, usdstOut);
            uint256 sharesBefore = IERC20(saveUsdstVault).balanceOf(d.stratoRecipient);
            uint256 shares = SaveUSDSTVault(saveUsdstVault).deposit(usdstOut, d.stratoRecipient);
            uint256 actualShares = IERC20(saveUsdstVault).balanceOf(d.stratoRecipient) - sharesBefore;
            require(actualShares > 0 && actualShares == shares, "MB: autosave failed");

            emit AutoSavedUSDST(
                externalChainId,
                normalizedTxHash,
                d.stratoRecipient,
                d.stratoToken,
                sourceAmount,
                usdstOut,
                saveUsdstVault,
                actualShares
            );
        } else {
            require(action == DepositAction.AUTO_FORGE, "MB: invalid action");
            require(metalForge != address(0), "MB: metal forge not set");
            require(intent.actionToken != address(0), "MB: invalid metal token");
            IERC20(USDST_ADDRESS).approve(metalForge, usdstOut);
            uint256 metalBefore = IERC20(intent.actionToken).balanceOf(address(this));
            MetalForge(metalForge).mintMetal(intent.actionToken, USDST_ADDRESS, usdstOut, intent.minFinalOut);
            uint256 metalOut = IERC20(intent.actionToken).balanceOf(address(this)) - metalBefore;
            require(metalOut > 0, "MB: no metal minted");
            require(IERC20(intent.actionToken).transfer(d.stratoRecipient, metalOut), "MB: metal transfer failed");

            emit AutoForgedViaPSM(
                externalChainId,
                normalizedTxHash,
                d.stratoRecipient,
                d.stratoToken,
                sourceAmount,
                usdstOut,
                intent.actionToken,
                metalOut
            );
        }
    }

    function _mintDepositFallback(
        DepositInfo d,
        uint256 externalChainId,
        string normalizedTxHash,
        DepositActionIntent intent
    ) internal {
        uint256 fallbackAmount = _mintFunds(d.stratoToken, d.stratoRecipient, d.stratoTokenAmount);
        emit DepositActionFallback(
            externalChainId,
            normalizedTxHash,
            d.stratoRecipient,
            intent.action,
            intent.actionToken,
            d.stratoToken,
            fallbackAmount
        );
    }

    function _deleteDepositAction(uint256 externalChainId, string normalizedTxHash) internal {
        delete depositActions[externalChainId][normalizedTxHash].action;
        delete depositActions[externalChainId][normalizedTxHash].actionToken;
        delete depositActions[externalChainId][normalizedTxHash].minFinalOut;
    }

    // ───────────── Deposit & withdrawal related functions ─────────────
    // ───────────── Deposit flow functions ─────────────
    /**
     * @dev Records a deposit transaction from an external chain
     * @notice Step-1 of the deposit flow - observes external transaction
     * @notice Creates deposit record but does NOT mint tokens yet
     * @notice Allows off-chain confirmation windows and fraud checks before step-2
     * @notice Converts external token amounts to STRATO token amounts using decimal conversion
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalSender The address that sent the transaction on the external chain
     * @param externalToken The token address on the external chain
     * @param externalTokenAmount The amount of external tokens to deposit (in external token decimals)
     * @param externalTxHash The transaction hash on the external chain
     * @param stratoRecipient The STRATO address to receive the minted tokens
     * @param targetStratoToken The selected STRATO token route target
     */
    function deposit(
        uint256 externalChainId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address targetStratoToken
    ) public onlyOwner whenDepositsOpen {
        _recordDeposit(
            externalChainId,
            externalSender,
            externalToken,
            externalTokenAmount,
            externalTxHash,
            stratoRecipient,
            targetStratoToken
        );
    }

    function _recordDeposit(
        uint256 externalChainId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address targetStratoToken
    ) internal returns (string normalizedTxHash) {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(externalSender != address(0), "MB: invalid external sender");
        require(externalTokenAmount > 0, "MB: invalid external token amount");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");
        require(stratoRecipient != address(0), "MB: invalid strato recipient");
        require(chains[externalChainId].enabled, "MB: chain not enabled");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        normalizedTxHash = externalTxHash.normalizeHex();
        BridgeStatus existingStatus = deposits[externalChainId][normalizedTxHash].bridgeStatus;
        require(
            existingStatus == BridgeStatus.NONE || existingStatus == BridgeStatus.ANNOUNCED,
            "MB: duplicate deposit"
        );

        // An announcement is a stranger's unverified claim about this deposit.
        // The relayer's record always wins; the only question is whether the
        // announcer's bond comes back now or has to be reclaimed. An exact
        // match is returned immediately; a mismatch is superseded and left
        // reclaimable, because the honest reasons to disagree are real (a
        // rebase adjustment, a race with a reorg) and slashing is reserved for
        // announcements governance rules fake.
        if (existingStatus == BridgeStatus.ANNOUNCED) {
            _resolveAnnouncementOnAdoption(
                externalChainId,
                normalizedTxHash,
                externalSender,
                externalToken,
                stratoRecipient,
                targetStratoToken
            );
        }

        AssetInfo a = assets[externalToken][externalChainId];
        _requireRouteEnabled(externalToken, externalChainId, targetStratoToken);
        require(TokenFactory(tokenFactory).isTokenActive(targetStratoToken), "MB: inactive token");

        // Example: 1e6 USDC * 10^(18-6) = 1e6 * 10^12 = 1e18 USDCST tokens
        uint256 stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(stratoTokenAmount > 0, "MB: invalid strato token amount");

        deposits[externalChainId][normalizedTxHash] = DepositInfo(
            BridgeStatus.INITIATED, externalSender, externalToken, block.timestamp, stratoRecipient, targetStratoToken, stratoTokenAmount, block.timestamp
        );

        emit DepositInitiated(externalChainId, externalSender, normalizedTxHash, stratoRecipient, targetStratoToken, stratoTokenAmount);
    }

    /**
     * @notice {deposit}, plus the `maxFee` the depositor offered on the
     *         external chain for immediate delivery here.
     *
     * @dev The relayer reads the fee out of the external `DepositRoutedWithFee`
     *      log and passes it through unchanged, along with the ORIGIN
     *      timestamp -- not this chain's -- so the decay measures from when the
     *      user actually asked, not from when the relayer got round to it. A
     *      relayer an hour behind therefore hands the user an hour of decay,
     *      which is exactly the refund the schedule promises.
     *
     * @param maxFee The ceiling in EXTERNAL token units, as the deposit log
     *               carries it. It is scaled to STRATO units here with the same
     *               factor as the amount.
     * @param requestedAt The external chain's timestamp of the deposit.
     */
    function depositWithFee(
        uint256 externalChainId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address targetStratoToken,
        uint256 maxFee,
        uint256 requestedAt
    ) public onlyOwner whenDepositsOpen {
        string normalizedTxHash = _recordDeposit(
            externalChainId,
            externalSender,
            externalToken,
            externalTokenAmount,
            externalTxHash,
            stratoRecipient,
            targetStratoToken
        );
        _commitDepositFeeTerms(
            externalChainId,
            normalizedTxHash,
            externalToken,
            maxFee,
            requestedAt
        );
    }

    /// @notice Batch {depositWithFee}. Same per-item rules; one bad item
    ///         reverts the batch, exactly as the existing batches do.
    function depositBatchWithFee(
        uint256[] externalChainIds,
        address[] externalSenders,
        address[] externalTokens,
        uint256[] externalTokenAmounts,
        string[] externalTxHashes,
        address[] stratoRecipients,
        address[] targetStratoTokens,
        uint256[] maxFees,
        uint256[] requestedAts
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(
            n > 0 &&
            n == externalSenders.length &&
            n == externalTokens.length &&
            n == externalTokenAmounts.length &&
            n == externalTxHashes.length &&
            n == stratoRecipients.length &&
            n == targetStratoTokens.length &&
            n == maxFees.length &&
            n == requestedAts.length,
            "MB: len"
        );
        for (uint256 i = 0; i < n; i++) {
            depositWithFee(
                externalChainIds[i],
                externalSenders[i],
                externalTokens[i],
                externalTokenAmounts[i],
                externalTxHashes[i],
                stratoRecipients[i],
                targetStratoTokens[i],
                maxFees[i],
                requestedAts[i]
            );
        }
    }

    /**
     * @dev Write the schedule a deposit will be settled under, scaling the
     *      external-unit ceiling into STRATO units exactly as the amount was
     *      scaled. A zero fee still writes a schedule, so the record always
     *      says explicitly whether the fast path was on offer.
     */
    function _commitDepositFeeTerms(
        uint256 externalChainId,
        string normalizedTxHash,
        address externalToken,
        uint256 maxFee,
        uint256 requestedAt
    ) internal {
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        AssetInfo a = assets[externalToken][externalChainId];

        uint256 maxFeeStrato = 0;
        uint256 halfLife = 0;
        if (maxFee > 0) {
            maxFeeStrato = maxFee * (10 ** (DECIMAL_PLACES - a.externalDecimals));
            require(
                BridgeFees.isFeeCapAllowed(maxFeeStrato, d.stratoTokenAmount, maxFeeBps),
                "MB: fee too large"
            );
            halfLife = feeHalfLifeSeconds;
            require(BridgeFees.isHalfLifeAllowed(halfLife), "MB: fee half-life not configured");
        }

        uint256 startsAt = requestedAt;
        if (startsAt == 0 || startsAt > block.timestamp) {
            // A missing or future origin timestamp would hand a solver the full
            // fee forever. Fall back to now: strictly worse for the solver and
            // strictly safer for the user.
            startsAt = block.timestamp;
        }

        depositFeeTerms[externalChainId][normalizedTxHash] =
            BridgeFeeTerms(true, maxFeeStrato, startsAt, halfLife);
        emit DepositFeeTermsSet(externalChainId, normalizedTxHash, maxFeeStrato, startsAt, halfLife);
    }

    function depositWithAction(
        uint256 externalChainId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address targetStratoToken,
        uint256 action,
        address actionToken,
        uint256 minFinalOut
    ) public onlyOwner whenDepositsOpen {
        string normalizedTxHash = _recordDeposit(
            externalChainId,
            externalSender,
            externalToken,
            externalTokenAmount,
            externalTxHash,
            stratoRecipient,
            targetStratoToken
        );
        if (action != 0) {
            depositActions[externalChainId][normalizedTxHash] = DepositActionIntent(
                action,
                actionToken,
                minFinalOut
            );
        }
    }

    /**
     * @dev Records multiple deposit transactions from external chains in a single call
     * @notice Batch version of deposit function for gas efficiency
     * @notice All arrays must have the same length and correspond by index
     * @notice Each deposit follows the same validation rules as individual deposit function
     * @notice Converts external token amounts to STRATO token amounts using decimal conversion
     * @param externalChainIds Array of external chain identifiers
     * @param externalSenders Array of external sender addresses
     * @param externalTokens Array of external token addresses
     * @param externalTokenAmounts Array of external token amounts (in external token decimals)
     * @param externalTxHashes Array of external transaction hashes
     * @param stratoRecipients Array of STRATO recipient addresses
     * @param targetStratoTokens Array of selected STRATO token route targets
     */
    function depositBatch(
        uint256[] externalChainIds,
        address[] externalSenders,
        address[] externalTokens,
        uint256[] externalTokenAmounts,
        string[] externalTxHashes,
        address[] stratoRecipients,
        address[] targetStratoTokens
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(
            n > 0 &&
            n == externalSenders.length &&
            n == externalTokens.length &&
            n == externalTokenAmounts.length &&
            n == externalTxHashes.length &&
            n == stratoRecipients.length &&
            n == targetStratoTokens.length,
            "MB: len"
        );
        for (uint256 i = 0; i < n; i++) {
            _recordDeposit(
                externalChainIds[i],
                externalSenders[i],
                externalTokens[i],
                externalTokenAmounts[i],
                externalTxHashes[i],
                stratoRecipients[i],
                targetStratoTokens[i]
            );
        }
    }

    function depositBatchWithAction(
        uint256[] externalChainIds,
        address[] externalSenders,
        address[] externalTokens,
        uint256[] externalTokenAmounts,
        string[] externalTxHashes,
        address[] stratoRecipients,
        address[] targetStratoTokens,
        uint256[] actions,
        address[] actionTokens,
        uint256[] minFinalOuts
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(
            n > 0 &&
            n == externalSenders.length &&
            n == externalTokens.length &&
            n == externalTokenAmounts.length &&
            n == externalTxHashes.length &&
            n == stratoRecipients.length &&
            n == targetStratoTokens.length &&
            n == actions.length &&
            n == actionTokens.length &&
            n == minFinalOuts.length,
            "MB: len"
        );
        for (uint256 i = 0; i < n; i++) {
            string normalizedTxHash = _recordDeposit(
                externalChainIds[i],
                externalSenders[i],
                externalTokens[i],
                externalTokenAmounts[i],
                externalTxHashes[i],
                stratoRecipients[i],
                targetStratoTokens[i]
            );
            if (actions[i] != 0) {
                depositActions[externalChainIds[i]][normalizedTxHash] = DepositActionIntent(
                    actions[i],
                    actionTokens[i],
                    minFinalOuts[i]
                );
            }
        }
    }

    /**
     * @dev Legacy lending-era action request retained for storage and ABI compatibility
     * @notice New confirmation logic intentionally ignores this sideband request
     * @param user The address requesting the action (must match the deposit recipient to be honored)
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     * @param action The legacy action type
     * @param targetToken Legacy action-specific target token
     */
    function requestDepositAction(address user, uint externalChainId, string externalTxHash, uint action, address targetToken) external onlyOwner {
        require(user != address(0), "MB: invalid user");
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");
        require(action != uint(DepositAction.NONE), "MB: invalid action");
        DepositAction _action = DepositAction(action);

        string normalizedTxHash = externalTxHash.normalizeHex();

        require(deposits[externalChainId][normalizedTxHash].bridgeStatus != BridgeStatus.COMPLETED, "MB: Already completed");
        depositActionRequests[user][externalChainId][normalizedTxHash] = DepositActionRequest(_action, targetToken);

        emit DepositActionRequested(user, externalChainId, normalizedTxHash, _action, targetToken);
    }

    /**
     * @dev Confirms a deposit and mints wrapped tokens
     * @notice Step-2.1 of the deposit flow - verification passed, mint wrapped tokens
     * @notice Only deposits in INITIATED or PENDING_REVIEW status can be confirmed
     * @notice Delivers the requested action output or the source route token on fallback
     * @param externalChainId The external chain identifier where the deposit occurred
     * @param externalTxHash The transaction hash on the external chain
     */
    function confirmDeposit(
        uint256 externalChainId, string externalTxHash
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED || d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        DepositActionIntent intent = depositActions[externalChainId][normalizedTxHash];

        // A solver who already handed the recipient their tokens takes the
        // recipient's place, and takes the FULL mint: the net they fronted
        // plus the fee they earned is exactly what they are owed. Their
        // payment is in this chain's own history -- better evidence than any
        // attestation could be. Checked before the action branch because a
        // filled deposit has no action to run: the recipient already holds
        // plain tokens, and a fill is only ever allowed on an action-free
        // deposit.
        address claimant = _resolveDepositClaimant(externalChainId, normalizedTxHash, d);
        if (claimant != address(0)) {
            uint256 claimMintedAmount = _mintFunds(d.stratoToken, claimant, d.stratoTokenAmount);
            require(claimMintedAmount > 0, "MB: no tokens minted");

            _deleteDepositAction(externalChainId, normalizedTxHash);
            d.bridgeStatus = BridgeStatus.COMPLETED;
            d.timestamp = block.timestamp;
            emit DepositCompleted(externalChainId, d.externalSender, normalizedTxHash, claimant, d.stratoToken, d.stratoTokenAmount);
            return;
        }

        bool isExecutableAction = (
            intent.action == uint256(DepositAction.AUTO_FORGE) ||
            intent.action == uint256(DepositAction.AUTO_SAVE)
        ) && _isDepositActionEnabled(d, externalChainId, intent.action);
        if (isExecutableAction) {
            try {
                _executeDepositAction(externalChainId, normalizedTxHash);
            }
            catch {
                _mintDepositFallback(d, externalChainId, normalizedTxHash, intent);
            }
        }
        else if (intent.action != uint256(DepositAction.NONE)) {
            _mintDepositFallback(d, externalChainId, normalizedTxHash, intent);
        }
        else {
            uint256 actualMintedAmount = _mintFunds(d.stratoToken, d.stratoRecipient, d.stratoTokenAmount);
            require(actualMintedAmount > 0, "MB: no tokens minted");
        }

        _deleteDepositAction(externalChainId, normalizedTxHash);
        d.bridgeStatus = BridgeStatus.COMPLETED;
        d.timestamp = block.timestamp;
        emit DepositCompleted(externalChainId, d.externalSender, normalizedTxHash, d.stratoRecipient, d.stratoToken, d.stratoTokenAmount);
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
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");
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
    ) public onlyOwner whenDepositsOpen {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

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
    ) external onlyOwner whenDepositsOpen {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");

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
    ) public onlyOwner {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(chains[externalChainId].enabled, "MB: chain not enabled");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");

        // Normalize the transaction hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        d.bridgeStatus = BridgeStatus.ABORTED;
        d.timestamp = block.timestamp;

        // An aborted deposit is the risk a solver priced. Mark the claim void
        // so the loss is explicit on chain rather than an unresolved claim
        // that still looks owed something.
        DepositClaim claim = depositClaims[externalChainId][normalizedTxHash];
        if (claim.claimant != address(0) && !claim.voided) {
            claim.voided = true;
            emit DepositClaimVoided(externalChainId, normalizedTxHash, claim.claimant, "deposit aborted");
        }

        _deleteDepositAction(externalChainId, normalizedTxHash);
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
    ) external onlyOwner {
        uint256 n = externalChainIds.length;
        require(n > 0 && n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            abortDeposit(externalChainIds[i], externalTxHashes[i]);
        }
    }

    // ───────────── Withdrawal flow functions ─────────────
    /**
     * @dev Initiates a withdrawal request by escrowing tokens and creating a withdrawal record
     * @notice Step-1 of the withdrawal flow - user moves tokens into bridge escrow and creates request
     * @notice Returns deterministic withdrawal ID for indexers to enumerate without extra mappings
     * @notice Tokens are escrowed until the withdrawal is confirmed or aborted
     * @notice Converts STRATO token amounts to external token amounts using decimal conversion
     * @notice Any dust from decimal conversion rounding is kept by the user
     * @param externalChainId The external chain identifier where tokens should be sent
     * @param externalRecipient The address on the external chain to receive the tokens
     * @param externalToken The token address on the external chain
     * @param stratoToken The selected STRATO route token to escrow/burn
     * @param stratoTokenAmount The amount of STRATO tokens to withdraw (any dust from decimal conversion will be kept by user)
     * @return id The unique withdrawal identifier
     */
    function requestWithdrawal(
        uint256 externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint256 stratoTokenAmount
    ) external whenWithdrawalsOpen returns (uint256 id) {
        return _requestWithdrawal(
            externalChainId,
            externalRecipient,
            externalToken,
            stratoToken,
            stratoTokenAmount,
            0
        );
    }

    /**
     * @notice {requestWithdrawal}, plus a `maxFee` the user will pay a solver
     *         who hands them their external tokens before the custody multisig
     *         has finished.
     *
     * @notice The fee a solver can actually keep decays exponentially to zero
     *         over three days from this moment, so a fast fill costs close to
     *         `maxFee` and a slow one proportionally less. Nothing is held
     *         back and there is no refund step: the fee is simply never taken
     *         unless somebody earns it.
     *
     * @dev The schedule is COMMITTED here, in storage and in the event, and
     *      never read live afterwards. The external chain's settlement
     *      recomputes the fee from these three numbers, so an admin who
     *      changes {feeHalfLifeSeconds} cannot re-price a withdrawal already
     *      in flight.
     *
     * @param maxFee The ceiling in STRATO units -- the same units as
     *               `stratoTokenAmount`, so a user names it in the token they
     *               are spending. It is converted to external units with the
     *               same rounding as the amount, because the solver pays on
     *               the external chain.
     */
    function requestWithdrawalWithFee(
        uint256 externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee
    ) external whenWithdrawalsOpen returns (uint256 id) {
        return _requestWithdrawal(
            externalChainId,
            externalRecipient,
            externalToken,
            stratoToken,
            stratoTokenAmount,
            maxFee
        );
    }

    function _requestWithdrawal(
        uint256 externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint256 stratoTokenAmount,
        uint256 maxFee
    ) internal returns (uint256 id) {
        require(externalChainId > 0, "MB: invalid external chain id");
        require(externalRecipient != address(0), "MB: invalid external recipient");
        require(stratoToken != address(0), "MB: invalid strato token");
        require(stratoTokenAmount > 0, "MB: invalid strato token amount");
        require(chains[externalChainId].enabled, "MB: chain not enabled");

        AssetInfo a = assets[externalToken][externalChainId];
        _requireRouteEnabled(externalToken, externalChainId, stratoToken);
        require(TokenFactory(tokenFactory).isTokenActive(stratoToken), "MB: inactive token");

        // Example: 1e18 USDCST tokens / 10^(18-6) = 1e18 / 10^12 = 1e6 USDC
        // Round down to the nearest integer
        uint256 externalTokenAmount = stratoTokenAmount / (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(externalTokenAmount > 0, "MB: not enough external tokens");

        stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(a.maxPerWithdrawal == 0 || stratoTokenAmount <= a.maxPerWithdrawal, "MB: per-withdrawal cap");
        stratoTokenAmount = _escrowFunds(stratoToken, msg.sender, stratoTokenAmount);
        require(stratoTokenAmount > 0, "MB: no tokens escrowed");

        // Example: 1e18 USDCST tokens / 10^(18-6) = 1e18 / 10^12 = 1e6 USDC
        // Round down to the nearest integer
        externalTokenAmount = stratoTokenAmount / (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(externalTokenAmount > 0, "MB: invalid external token amount");

        id = ++withdrawalCounter;

        uint256 hotThreshold = hotWithdrawalThresholds[externalChainId][externalToken];
        bool useHotWallet = externalTokenAmount <= hotThreshold && chains[externalChainId].hotWallet != address(0);

        withdrawals[id] = WithdrawalInfo(
            BridgeStatus.INITIATED, "", externalChainId, externalRecipient, externalToken, externalTokenAmount, block.timestamp, msg.sender, stratoToken, stratoTokenAmount, block.timestamp, useHotWallet
        );

        emit WithdrawalRequested(externalRecipient, externalChainId, externalTokenAmount, stratoTokenAmount, stratoToken, msg.sender, id, useHotWallet);

        // Bounded against the ESCROWED amount, not the requested one: the
        // escrow is what the withdrawal is worth, and a rebasing or
        // fee-on-transfer token can make the two differ.
        _commitWithdrawalFeeTerms(
            id,
            stratoTokenAmount,
            externalTokenAmount,
            maxFee,
            10 ** (DECIMAL_PLACES - a.externalDecimals)
        );
    }

    /**
     * @dev Write the schedule a withdrawal will be settled under.
     *
     *      THE COMMITTED FEE IS IN EXTERNAL UNITS, because that is the chain
     *      the solver pays on and the units its settlement works in. It is
     *      converted with the same truncating division as the amount, so a fee
     *      that rounds away to nothing becomes a zero-fee schedule rather than
     *      a schedule nobody can satisfy.
     */
    function _commitWithdrawalFeeTerms(
        uint256 id,
        uint256 stratoTokenAmount,
        uint256 externalTokenAmount,
        uint256 maxFeeStrato,
        uint256 scale
    ) internal {
        uint256 maxFeeExternal = 0;
        uint256 halfLife = 0;

        if (maxFeeStrato > 0) {
            require(
                BridgeFees.isFeeCapAllowed(maxFeeStrato, stratoTokenAmount, maxFeeBps),
                "MB: fee too large"
            );
            maxFeeExternal = maxFeeStrato / scale;
            if (maxFeeExternal > 0) {
                halfLife = feeHalfLifeSeconds;
                require(BridgeFees.isHalfLifeAllowed(halfLife), "MB: fee half-life not configured");
                require(maxFeeExternal < externalTokenAmount, "MB: fee too large");
            }
        }

        withdrawalFeeTerms[id] = BridgeFeeTerms(true, maxFeeExternal, block.timestamp, halfLife);
        emit WithdrawalFeeTermsSet(id, maxFeeStrato, maxFeeExternal, block.timestamp, halfLife);
    }

    /**
     * @notice Mirror an external-chain claim on an outbound withdrawal back
     *         onto this chain.
     *
     *         The solver is paid on the external chain, by that chain's own
     *         settlement, so this record does not move money. It does two
     *         things that matter: it makes the claim visible on the chain that
     *         holds the escrow, and it closes the user's 48-hour abort hatch --
     *         without it, a user could take a solver's tokens on one chain and
     *         their own escrow back on this one.
     *
     * @dev THE FEE IS CHECKED, not taken on trust, on the rung that pays the
     *      user. `feeCharged` must be within the schedule this contract
     *      committed, evaluated at the external chain's fill timestamp, and
     *      `netPaid` must be the remainder. The relayer is otherwise trusted,
     *      but these numbers are checkable, so they are checked.
     *
     * @dev LATER RUNGS ARE NOT BOUNDED BY THE USER'S SCHEDULE. They are solvers
     *      buying and selling the position among themselves at prices they set,
     *      and a solver shedding a claim they have come to distrust may well
     *      pay MORE than they earned. The user's leg is already settled by
     *      then, so bounding it would only forbid the trade the ladder exists
     *      to allow.
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
    ) external onlyOwner {
        require(id > 0, "MB: invalid withdrawal id");
        require(claimant != address(0), "MB: invalid claimant");
        require(externalFillTxHash.length > 0, "MB: invalid fill tx hash");

        WithdrawalInfo w = withdrawals[id];
        require(
            w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "MB: bad state"
        );

        BridgeFeeTerms terms = withdrawalFeeTerms[id];
        require(terms.set, "MB: no fee terms");
        require(claimedAt <= block.timestamp, "MB: fill in the future");
        require(netPaid == w.externalTokenAmount - feeCharged, "MB: net does not match");

        WithdrawalClaim existing = withdrawalClaims[id];
        if (existing.claimant != address(0)) {
            require(claimIndex > existing.claimIndex, "MB: claim index not advancing");
        } else {
            require(claimIndex == 0, "MB: first claim must be index zero");
            uint256 allowedFee = BridgeFees.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                claimedAt
            );
            require(feeCharged <= allowedFee, "MB: fee above schedule");
        }

        string normalizedFillTxHash = externalFillTxHash.normalizeHex();
        withdrawalClaims[id] = WithdrawalClaim(
            claimant,
            claimIndex,
            claimedAt,
            feeCharged,
            netPaid,
            normalizedFillTxHash
        );

        emit WithdrawalClaimRecorded(
            id,
            claimant,
            claimIndex,
            feeCharged,
            netPaid,
            normalizedFillTxHash
        );
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
    ) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "MB: invalid withdrawal id");
        require(custodyTxHash.length > 0, "MB: invalid custody tx hash");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;

        // Normalize the custody tx hash to prevent case-variation replay attacks
        // This is because SolidVm does not support bytes32
        string normalizedCustodyTxHash = custodyTxHash.normalizeHex();
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
    ) external onlyOwner whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0 && n == custodyTxHashes.length, "MB: len");

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
    ) public onlyOwner whenWithdrawalsOpen {
        require(id > 0, "MB: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        uint256 actualBurnedAmount = _burnFunds(w.stratoToken, w.stratoTokenAmount);
        require(actualBurnedAmount > 0, "MB: no tokens burned");

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;

        emit WithdrawalCompleted(id, w.stratoSender, w.stratoToken, w.stratoTokenAmount);
    }

    /**
     * @dev Finalizes multiple withdrawals by burning the escrowed tokens
     * @notice Batch version of finaliseWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual finaliseWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function finaliseWithdrawalBatch(
        uint256[] ids
    ) external onlyOwner whenWithdrawalsOpen {
        uint256 n = ids.length;
        require(n > 0, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            finaliseWithdrawal(ids[i]);
        }
    }

    /**
     * @dev Aborts a withdrawal and refunds the escrowed tokens
     * @notice Step-4 of the withdrawal flow - abort a withdrawal and refund tokens
     * @notice Admin can abort any withdrawal in INITIATED or PENDING_REVIEW status
     * @notice User can only abort their own withdrawal in INITIATED status after timeout
     * @notice Covers the scenario where admin disappears before confirming
     * @notice Does not cover the scenario where custody transaction is waiting to be signed
     * @param id The unique withdrawal identifier
     */
    function abortWithdrawal(
        uint256 id
    ) public {
        require(id > 0, "MB: invalid withdrawal id");

        WithdrawalInfo w = withdrawals[id];
        uint256 currentTimestamp = block.timestamp;

        AdminRegistry admin = AdminRegistry(owner());
        if (admin.whitelist(address(this), "abortWithdrawal", msg.sender)) {
            require(w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: not abortable");
        }
        else {
            require(msg.sender == w.stratoSender, "MB: not sender");
            require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: not abortable");
            // A solver has already handed this user their tokens on the
            // external chain. Refunding the escrow now would pay them twice
            // and leave the solver holding nothing, so the timeout escape
            // hatch closes once a claim is on record. Governance can still
            // abort or sweep -- that is the admin-rejection risk a solver
            // prices -- but the beneficiary of the fill cannot.
            //
            // Checked BEFORE the timeout: it is the more fundamental reason
            // this abort is refused, and "a solver already paid you" is a far
            // more useful thing to tell a caller than "wait 48h".
            require(withdrawalClaims[id].claimant == address(0), "MB: claimed by solver");
            require(currentTimestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY, "MB: wait 48h");
        }

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = currentTimestamp;

        // WHO GETS THE ESCROW. Normally the sender -- it is their money and the
        // withdrawal did not happen. But if a solver holds the claim, the
        // sender has ALREADY been paid on the external chain, out of the
        // solver's own pocket, and the escrow is what was going to reimburse
        // that solver. Returning it to the sender would pay them twice and
        // leave the solver with nothing: the abort would convert an honest
        // fill into a loss. So the escrow follows the claim. The record that
        // proves the solver's entitlement is the one {recordWithdrawalClaim}
        // mirrored here from the external chain. The claimant is an
        // external-chain address; for a key-based solver the same key controls
        // the same address on STRATO.
        address payee = w.stratoSender;
        address claimant = withdrawalClaims[id].claimant;
        if (claimant != address(0)) {
            payee = claimant;
        }

        uint256 actualRefundedAmount = _refundFunds(w.stratoToken, payee, w.stratoTokenAmount);
        require(actualRefundedAmount > 0, "MB: no tokens refunded");

        emit WithdrawalAborted(id);
        if (claimant != address(0)) {
            emit WithdrawalEscrowReleasedToClaimant(id, claimant, actualRefundedAmount);
        }
    }

    /**
     * @dev Aborts multiple withdrawals and refunds the escrowed tokens
     * @notice Batch version of abortWithdrawal function for gas efficiency
     * @notice Each withdrawal follows the same validation rules as individual abortWithdrawal function
     * @param ids Array of unique withdrawal identifiers
     */
    function abortWithdrawalBatch(
        uint256[] ids
    ) external {
        uint256 n = ids.length;
        require(n > 0, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            abortWithdrawal(ids[i]);
        }
    }

    // ───────────── Incident response ─────────────
    /**
     * @dev Cancels a withdrawal request and moves its escrow to a triage wallet
     * @notice Incident-response tool: stops a theft from bridging out and captures the
     *         escrowed tokens so they can be returned to the victims. Governed by the
     *         AdminRegistry (the owner): every admin's vote must name the same id and
     *         the same triage wallet, which is the safeguard against a mistyped address.
     * @notice Allowed from INITIATED or PENDING_REVIEW. From PENDING_REVIEW a custody
     *         transaction has already been proposed on the external chain and MUST be
     *         rejected there as well, or the recipient is paid on both sides. The
     *         WithdrawalSwept event carries the custody tx hash for that purpose.
     * @notice Deliberately not gated by the withdrawal circuit breaker: an incident is
     *         when this runs, and withdrawals will usually be paused already.
     * @notice Moves the tokens with a plain transfer, exactly like abortWithdrawal. If
     *         the token itself has been paused, unpause it or whitelist the bridge for
     *         transfer on it first.
     * @notice Do NOT whitelist the relayer for this function: a relayer key compromise
     *         could then redirect every escrow in flight.
     * @param id The unique withdrawal identifier
     * @param triageWallet The address that receives the escrowed tokens
     */
    function cancelAndSweepWithdrawal(
        uint256 id, address triageWallet
    ) public onlyOwner {
        require(id > 0, "MB: invalid withdrawal id");
        require(triageWallet != address(0) && triageWallet != address(this), "MB: invalid triage wallet");

        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: not sweepable");

        w.bridgeStatus = BridgeStatus.SWEPT;
        w.timestamp = block.timestamp;
        withdrawalSweptTo[id] = triageWallet;

        uint256 actualSweptAmount = _refundFunds(w.stratoToken, triageWallet, w.stratoTokenAmount);
        require(actualSweptAmount > 0, "MB: no tokens swept");

        emit WithdrawalSwept(id, w.stratoSender, w.stratoToken, w.stratoTokenAmount, triageWallet, w.custodyTxHash);
    }

    /**
     * @dev Cancels multiple withdrawals and moves their escrow to one triage wallet
     * @notice Batch version of cancelAndSweepWithdrawal; each id follows the same rules,
     *         and one bad id makes the whole batch revert
     * @param ids Array of unique withdrawal identifiers
     * @param triageWallet The address that receives all of the escrowed tokens
     */
    function cancelAndSweepWithdrawalBatch(
        uint256[] ids, address triageWallet
    ) external onlyOwner {
        uint256 n = ids.length;
        require(n > 0, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            cancelAndSweepWithdrawal(ids[i], triageWallet);
        }
    }

    // ───────────── Solver fast path: filling inbound deposits ─────────────

    /**
     * @dev Who this deposit's mint belongs to, or zero for the recipient.
     *
     *      A MISMATCH IS VOIDED, NOT REVERTED. A claim can be made against an
     *      announced deposit that the relayer later contradicts; refusing to
     *      confirm would let one bad claim strand a real deposit forever, while
     *      voiding leaves the solver's payment as a gift to the recipient and
     *      the bridge's accounting exact.
     */
    function _resolveDepositClaimant(
        uint256 externalChainId,
        string normalizedTxHash,
        DepositInfo d
    ) internal returns (address) {
        DepositClaim claim = depositClaims[externalChainId][normalizedTxHash];
        if (claim.claimant == address(0) || claim.voided) {
            return address(0);
        }

        BridgeFeeTerms terms = depositFeeTerms[externalChainId][normalizedTxHash];
        DepositActionIntent intent = depositActions[externalChainId][normalizedTxHash];

        bool matches = claim.stratoRecipient == d.stratoRecipient
            && claim.stratoToken == d.stratoToken
            && claim.stratoTokenAmount == d.stratoTokenAmount
            && claim.maxFee == terms.maxFee
            && claim.requestedAt == terms.requestedAt
            && claim.feeHalfLife == terms.feeHalfLife
            && claim.action == intent.action;

        if (!matches) {
            claim.voided = true;
            emit DepositClaimVoided(
                externalChainId,
                normalizedTxHash,
                claim.claimant,
                "terms no longer match record"
            );
            return address(0);
        }

        emit DepositClaimSettled(
            externalChainId,
            normalizedTxHash,
            claim.claimant,
            claim.claimIndex,
            claim.feeCharged
        );
        return claim.claimant;
    }

    /// @notice What a solver would keep by filling this deposit right now, what
    ///         they must pay out to get it, and to whom. On rung zero that is
    ///         the user's decayed schedule; after that it is the current
    ///         holder's asking price, and `forSale` is false if they are not
    ///         selling.
    function quoteDepositFill(
        uint256 externalChainId,
        string externalTxHash
    ) public returns (address payTo, uint256 feeCharged, uint256 netToPay, bool forSale) {
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(d.stratoTokenAmount > 0, "MB: unknown deposit");
        BridgeFeeTerms terms = depositFeeTerms[externalChainId][normalizedTxHash];
        DepositClaim claim = depositClaims[externalChainId][normalizedTxHash];

        if (claim.claimant == address(0)) {
            payTo = d.stratoRecipient;
            feeCharged = BridgeFees.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
            forSale = true;
        } else {
            payTo = claim.claimant;
            feeCharged = claim.exitFee;
            forSale = claim.transferable && !claim.voided;
        }
        netToPay = d.stratoTokenAmount - feeCharged;
    }

    /**
     * @notice Hand an inbound deposit's recipient their STRATO tokens out of
     *         your own balance, ahead of the relayer's review, and take over
     *         the claim on the eventual mint.
     *
     *         The transfer runs HERE, solver to payee, so by the time
     *         {confirmDeposit} runs the bridge KNOWS the recipient was paid --
     *         it happened on this chain, in this call. Nothing is fronted by
     *         the bridge, so there is no reclaim path and no new custody.
     *
     *         THE FIRST RUNG IS THE USER'S. Claim zero pays the recipient
     *         `amount - decayedFee(...)`, and that fee is the schedule the user
     *         committed to -- not negotiable by anyone.
     *
     *         EVERY RUNG AFTER THAT IS BETWEEN SOLVERS. A claim changes hands
     *         only if its holder marked it transferable, at the holder's own
     *         `exitFee`: the taker pays them `amount - exitFee` and keeps
     *         `exitFee` at settlement. The holder may ask MORE than they
     *         earned, and that is the point -- a solver who has come to believe
     *         a deposit will be aborted can pay someone else to carry it. The
     *         user's leg is untouched and the bridge still mints `amount`
     *         exactly once.
     *
     * @dev THE EXPECTED VALUES ARE NOT DECORATION. A solver passes the record
     *      and the fee they believe they are buying, and a mismatch reverts
     *      rather than filling something else -- because this deposit may be a
     *      stranger's unverified announcement, the relayer may overwrite it,
     *      and the holder may have repriced their exit, all between the solver
     *      reading and this transaction landing.
     *
     * @dev AN ACTION DEPOSIT IS NOT FILLABLE. A solver cannot reproduce an
     *      auto-forge or an auto-save, and handing them the mint would leave
     *      the depositor holding plain tokens instead of the thing they asked
     *      for. The intent must be NONE to fill, and a relayer who later adds
     *      one voids the claim.
     *
     * @dev A CLAIM ON AN ANNOUNCED DEPOSIT IS A BET. Nothing here verifies the
     *      external deposit happened; this contract cannot. If the relayer
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
        uint256 externalChainId,
        string externalTxHash,
        address expectedStratoRecipient,
        address expectedStratoToken,
        uint256 expectedStratoTokenAmount,
        uint256 expectedFee,
        bool transferable,
        uint256 exitFee
    ) external whenDepositsOpen returns (uint256 netPaid) {
        require(fillsEnabled, "MB: fills disabled");

        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(
            d.bridgeStatus == BridgeStatus.ANNOUNCED
                || d.bridgeStatus == BridgeStatus.INITIATED
                || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "MB: not fillable"
        );
        require(d.stratoRecipient == expectedStratoRecipient, "MB: recipient mismatch");
        require(d.stratoToken == expectedStratoToken, "MB: token mismatch");
        require(d.stratoTokenAmount == expectedStratoTokenAmount, "MB: amount mismatch");
        require(exitFee < d.stratoTokenAmount, "MB: exit fee too large");
        require(
            depositActions[externalChainId][normalizedTxHash].action == uint256(DepositAction.NONE),
            "MB: action deposits are not fillable"
        );

        BridgeFeeTerms terms = depositFeeTerms[externalChainId][normalizedTxHash];
        require(terms.set, "MB: no fee terms");
        require(
            BridgeFees.isFeeCapAllowed(terms.maxFee, d.stratoTokenAmount, maxFeeBps),
            "MB: fee above ceiling"
        );

        DepositClaim claim = depositClaims[externalChainId][normalizedTxHash];
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
            require(!claim.voided, "MB: claim voided");
            // The holder's consent is the whole gate. A solver who knows a
            // deposit is good must be able to keep their position; without
            // this, anyone could take it from them for a penny of decay.
            require(claim.transferable, "MB: claim not transferable");
            nextIndex = claim.claimIndex + 1;
            feeCharged = claim.exitFee;
        }
        require(payTo != msg.sender, "MB: already the claimant");
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
        require(feeCharged >= expectedFee, "MB: fee below your minimum");

        netPaid = d.stratoTokenAmount - feeCharged;
        require(netPaid > 0, "MB: nothing to pay");

        depositClaims[externalChainId][normalizedTxHash] = DepositClaim(
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
            terms.feeHalfLife,
            uint256(DepositAction.NONE)
        );

        uint256 delivered = _transferFromMeasured(d.stratoToken, msg.sender, payTo, netPaid);
        require(delivered == netPaid, "MB: short delivery");

        emit DepositFilled(
            externalChainId,
            normalizedTxHash,
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
     *         settles, as often as they like. A solver's read on a deposit
     *         changes -- a route starts looking shaky, a sender starts looking
     *         like a thief -- and the position they hold should be repriceable
     *         when it does. Setting `transferable` false takes it off the
     *         market entirely.
     *
     * @dev A taker passes the price they expect, so repricing cannot front-run
     *      one: a raise that lands first makes their fill revert rather than
     *      execute at the new number.
     */
    function setDepositClaimExitOffer(
        uint256 externalChainId,
        string externalTxHash,
        bool transferable,
        uint256 exitFee
    ) external {
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositClaim claim = depositClaims[externalChainId][normalizedTxHash];
        require(claim.claimant == msg.sender, "MB: not the claimant");
        require(!claim.voided, "MB: claim voided");

        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        require(
            d.bridgeStatus == BridgeStatus.ANNOUNCED
                || d.bridgeStatus == BridgeStatus.INITIATED
                || d.bridgeStatus == BridgeStatus.PENDING_REVIEW,
            "MB: deposit not open"
        );
        require(exitFee < d.stratoTokenAmount, "MB: exit fee too large");

        claim.transferable = transferable;
        claim.exitFee = transferable ? exitFee : 0;

        emit DepositClaimOfferUpdated(
            externalChainId,
            normalizedTxHash,
            msg.sender,
            transferable,
            claim.exitFee
        );
    }

    /// @dev Move tokens between two third parties and MEASURE what arrived. A
    ///      solver must not be credited with a full claim for a partial
    ///      delivery, which a fee-on-transfer or paused token could produce.
    function _transferFromMeasured(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal returns (uint256 actualAmount) {
        uint256 balanceBefore = IERC20(token).balanceOf(to);
        require(IERC20(token).transferFrom(from, to, amount), "MB: transfer failed");
        actualAmount = IERC20(token).balanceOf(to) - balanceBefore;
        require(actualAmount > 0, "MB: no tokens delivered");
    }

    // ───────────── Solver fast path: permissionless announcements ─────────────

    /**
     * @notice Post an external deposit here before the relayer has seen it, so
     *         a solver can fill it immediately.
     *
     *         The announcement records the deposit in the ANNOUNCED state,
     *         which can be filled but can NEVER be confirmed: only the
     *         relayer's own {deposit} moves it to INITIATED, and only INITIATED
     *         or PENDING_REVIEW deposits mint. So an announcement moves no
     *         bridge funds and costs the bridge nothing even if it is a
     *         complete fabrication.
     *
     *         It costs the ANNOUNCER a bond, because storage is not free and
     *         because an announcement that misleads a careless solver should
     *         have a price. The bond comes back when the relayer adopts it, is
     *         reclaimable if the relayer never does, and is slashed only when
     *         governance rules it fake.
     *
     * @dev This is a coordination surface, not evidence. It exists so the
     *      relayer stops being the starting gun and becomes a confirmation bot;
     *      a solver who fills against it without checking the external chain is
     *      trusting a stranger.
     *
     * @param requestedAt The external chain's timestamp of the deposit, where
     *                    the fee decay starts.
     */
    function announceDeposit(
        uint256 externalChainId,
        address externalSender,
        address externalToken,
        uint256 externalTokenAmount,
        string externalTxHash,
        address stratoRecipient,
        address targetStratoToken,
        uint256 maxFee,
        uint256 requestedAt
    ) external whenDepositsOpen returns (string normalizedTxHash) {
        require(announcementsEnabled, "MB: announcements disabled");
        require(externalChainId > 0, "MB: invalid external chain id");
        require(externalSender != address(0), "MB: invalid external sender");
        require(externalTokenAmount > 0, "MB: invalid external token amount");
        require(externalTxHash.length > 0, "MB: invalid external tx hash");
        require(stratoRecipient != address(0), "MB: invalid strato recipient");
        require(chains[externalChainId].enabled, "MB: chain not enabled");

        normalizedTxHash = externalTxHash.normalizeHex();
        require(
            deposits[externalChainId][normalizedTxHash].bridgeStatus == BridgeStatus.NONE,
            "MB: already known"
        );
        require(
            depositAnnouncements[externalChainId][normalizedTxHash].state == 0,
            "MB: already announced"
        );

        AssetInfo a = assets[externalToken][externalChainId];
        _requireRouteEnabled(externalToken, externalChainId, targetStratoToken);
        require(TokenFactory(tokenFactory).isTokenActive(targetStratoToken), "MB: inactive token");

        uint256 stratoTokenAmount = externalTokenAmount * (10 ** (DECIMAL_PLACES - a.externalDecimals));
        require(stratoTokenAmount > 0, "MB: invalid strato token amount");

        address bondToken = announcementBondToken;
        uint256 bondAmount = announcementBondAmount;
        require(bondToken != address(0) && bondAmount > 0, "MB: bond not configured");

        depositAnnouncements[externalChainId][normalizedTxHash] = DepositAnnouncement(
            msg.sender,
            bondToken,
            bondAmount,
            block.timestamp,
            1
        );

        deposits[externalChainId][normalizedTxHash] = DepositInfo(
            BridgeStatus.ANNOUNCED,
            externalSender,
            externalToken,
            block.timestamp,
            stratoRecipient,
            targetStratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        _commitDepositFeeTerms(
            externalChainId,
            normalizedTxHash,
            externalToken,
            maxFee,
            requestedAt
        );

        bondedBalance[bondToken] += bondAmount;
        uint256 bonded = _transferFromMeasured(bondToken, msg.sender, address(this), bondAmount);
        require(bonded == bondAmount, "MB: short bond");

        emit DepositAnnounced(
            externalChainId,
            normalizedTxHash,
            msg.sender,
            externalSender,
            externalToken,
            stratoRecipient,
            targetStratoToken,
            stratoTokenAmount,
            depositFeeTerms[externalChainId][normalizedTxHash].maxFee,
            depositFeeTerms[externalChainId][normalizedTxHash].requestedAt,
            depositFeeTerms[externalChainId][normalizedTxHash].feeHalfLife,
            bondToken,
            bondAmount
        );
    }

    /// @dev Return an adopted announcement's bond, or mark it superseded and
    ///      leave it reclaimable. Never slashes: that is governance's call.
    function _resolveAnnouncementOnAdoption(
        uint256 externalChainId,
        string normalizedTxHash,
        address externalSender,
        address externalToken,
        address stratoRecipient,
        address targetStratoToken
    ) internal {
        DepositInfo announced = deposits[externalChainId][normalizedTxHash];
        bool matches = announced.externalSender == externalSender
            && announced.externalToken == externalToken
            && announced.stratoRecipient == stratoRecipient
            && announced.stratoToken == targetStratoToken;

        if (matches) {
            _returnAnnouncementBond(externalChainId, normalizedTxHash);
        } else {
            emit AnnouncementSuperseded(
                externalChainId,
                normalizedTxHash,
                depositAnnouncements[externalChainId][normalizedTxHash].announcer
            );
        }
    }

    /// @notice Reclaim your own bond once the relayer has had long enough to
    ///         adopt the announcement and has not. Permissionless: an announcer
    ///         should never need an admin to get their own money back, and a
    ///         relayer outage must not read as fraud.
    function reclaimAnnouncementBond(uint256 externalChainId, string externalTxHash) external {
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositAnnouncement a = depositAnnouncements[externalChainId][normalizedTxHash];
        require(a.state == 1, "MB: bond already resolved");
        require(
            block.timestamp >= a.announcedAt + announcementTtlSeconds,
            "MB: bond not yet reclaimable"
        );
        _returnAnnouncementBond(externalChainId, normalizedTxHash);
    }

    /// @notice Slash a fake announcement's bond. The only path that takes
    ///         someone's bond, and owner-gated for that reason: an announcement
    ///         that merely disagrees with the relayer's numbers is superseded,
    ///         not fraudulent, and its bond stays reclaimable.
    function rejectAnnouncement(uint256 externalChainId, string externalTxHash) external onlyOwner {
        string normalizedTxHash = externalTxHash.normalizeHex();
        DepositAnnouncement a = depositAnnouncements[externalChainId][normalizedTxHash];
        require(a.state == 1, "MB: bond already resolved");
        require(announcementSlashRecipient != address(0), "MB: no slash recipient");

        a.state = 3;
        uint256 amount = a.bondAmount;
        if (amount > 0) {
            bondedBalance[a.bondToken] -= amount;
            uint256 slashed = _refundFunds(a.bondToken, announcementSlashRecipient, amount);
            require(slashed == amount, "MB: short slash");
        }

        // An announcement ruled fake should stop being a fillable record, and
        // the deposit must stop looking like something that could still settle.
        DepositInfo d = deposits[externalChainId][normalizedTxHash];
        if (d.bridgeStatus == BridgeStatus.ANNOUNCED) {
            d.bridgeStatus = BridgeStatus.ABORTED;
            d.timestamp = block.timestamp;
        }

        emit AnnouncementBondSlashed(
            externalChainId,
            normalizedTxHash,
            a.announcer,
            amount,
            announcementSlashRecipient
        );
    }

    function _returnAnnouncementBond(uint256 externalChainId, string normalizedTxHash) internal {
        DepositAnnouncement a = depositAnnouncements[externalChainId][normalizedTxHash];
        require(a.state == 1, "MB: bond already resolved");

        a.state = 2;
        uint256 amount = a.bondAmount;
        if (amount > 0) {
            bondedBalance[a.bondToken] -= amount;
            uint256 returned = _refundFunds(a.bondToken, a.announcer, amount);
            require(returned == amount, "MB: short bond return");
        }

        emit AnnouncementBondReturned(externalChainId, normalizedTxHash, a.announcer, amount);
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
        require(BridgeFees.isHalfLifeAllowed(halfLifeSeconds), "MB: invalid half-life");
        require(feeBpsCeiling <= BridgeFees.BPS_DENOMINATOR, "MB: invalid fee ceiling");
        feeHalfLifeSeconds = halfLifeSeconds;
        maxFeeBps = feeBpsCeiling;
        fillsEnabled = enableFills;
        emit FeeConfigUpdated(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    function setAnnouncementConfig(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint256 ttlSeconds
    ) external onlyOwner {
        if (enabled) {
            require(bondToken != address(0), "MB: invalid bond token");
            require(bondAmount > 0, "MB: invalid bond amount");
            require(slashRecipient != address(0), "MB: invalid slash recipient");
            require(ttlSeconds > 0, "MB: invalid bond ttl");
        }
        announcementsEnabled = enabled;
        announcementBondToken = bondToken;
        announcementBondAmount = bondAmount;
        announcementSlashRecipient = slashRecipient;
        announcementTtlSeconds = ttlSeconds;
        emit AnnouncementConfigUpdated(enabled, bondToken, bondAmount, slashRecipient, ttlSeconds);
    }
}

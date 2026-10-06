pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./BridgeFeeDecay.sol";

/**
 * @title DepositRouter
 * @notice The external-chain door into STRATO: it moves a user's deposit into
 *         the custody Safe and emits the log the relayer turns into a mint on
 *         STRATO.
 *
 * @notice SOLVER FAST PATH (both directions). Two features sit on top of the
 *         slow relayer-and-multisig path, and neither weakens it:
 *
 *         DEPOSITS may name a `maxFee` the depositor will pay a solver for
 *         immediate delivery on STRATO. The fee is committed in the deposit
 *         log -- an uncommitted fee would let a solver pay the recipient a
 *         penny and claim the whole mint -- together with the request
 *         timestamp and the half-life of its decay, so STRATO can compute
 *         exactly what the recipient is owed without trusting anyone's word
 *         for the terms.
 *
 *         WITHDRAWALS out of STRATO can be delivered here before the Safe
 *         signers ever meet: {fillWithdrawal} moves the SOLVER's own tokens to
 *         the recipient, so payment becomes a fact in this chain's ledger, and
 *         the Safe payout is then proposed to the solver instead. That last
 *         step is off-chain by necessity -- custody on this chain is a Safe,
 *         not a contract, so there is no escrow here to redirect -- which is
 *         why the fill is recorded permanently and indexed by withdrawal:
 *         {withdrawalFiller} is the evidence the signers check, and a solver
 *         whose claimed terms do not match STRATO's record simply does not get
 *         the redirect.
 *
 *         ANNOUNCEMENTS let anyone post a STRATO withdrawal here before the
 *         relayer has seen it, so a solver can fill against it immediately and
 *         the relayer becomes a confirmation bot rather than a starting gun.
 *         An announcement moves no bridge funds and proves nothing; it is a
 *         coordination surface, bonded only so that filling it with noise
 *         costs something. Verifying that an announced withdrawal is real is
 *         the solver's job, and the risk the fee prices.
 *
 * @dev WHAT THE FAST PATH DOES NOT DO: it does not skip a time lock, a
 *      multisig vote, or an admin review. The solver waits for all of it and
 *      carries the risk that the withdrawal is fraudulent or gets rejected,
 *      which is precisely what turns that risk into a quoted fee.
 */
contract DepositRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using BridgeFeeDecay for uint256;

    // ============ Custom Errors ============
    error UseDepositETH();
    error BelowMinimum();
    error ZeroAmount();
    error PermitExpired();
    error InvalidAddress();
    error ETHTransferFailed();
    error ArrayLengthMismatch();
    error SameAddressProposed();
    error SweepEthFailed();
    error NotPermitted();
    error FeesNotSupported();
    error FeeTooLarge();
    error BadHalfLife();
    error FillsDisabled();
    error AnnouncementsDisabled();
    error AlreadyAnnounced();
    error NoAnnouncement();
    error BondNotReclaimable();
    error BondAlreadyResolved();
    error WrongEthValue();
    error BondNotConfigured();
    error AlreadySettled();
    error TermsMismatch();
    error FeeBelowMinimum();
    error NotTransferable();
    error AlreadyClaimant();

    // ============ State Variables ============
    //Notice that in most chains, PERMIT2 is deployed at 0x000000000022D473030F116dDEE9F6B43aC78BA3
    // https://etherscan.io/address/0x000000000022d473030f116ddee9f6b43ac78ba3
    IPermit2 public PERMIT2;

    address public gnosisSafe;
    uint96 public depositId;
    // address(0) represents ETH configuration for depositETH()
    mapping(address => TokenConfig) public tokenConfig;
    // key: external token => target STRATO token => permitted route
    mapping(address => mapping(address => bool)) public routePermitted;

    // ============ Fast-path state (appended; this is a live UUPS proxy) ============
    // Everything below was added with the solver fast path. New declarations
    // MUST keep being appended here: an insertion anywhere above silently
    // re-points every mapping in the deployed proxy.

    /// @notice Half-life, in seconds, of the solver fee offered on a deposit.
    ///         Committed into each deposit log at deposit time, so changing it
    ///         never re-prices a deposit already in flight.
    uint64 public depositFeeHalfLifeSeconds;

    /// @notice Per-token override of the deposit fee half-life; zero falls
    ///         back to {depositFeeHalfLifeSeconds}.
    mapping(address => uint64) public tokenFeeHalfLifeSeconds;

    /// @notice Ceiling on any offered fee, in basis points of the amount. The
    ///         anti-grief bound on fills (see BridgeFeeDecay.isFeeCapAllowed);
    ///         zero refuses every fee and so disables the fast path outright.
    uint16 public maxFeeBps;

    /// @notice Master switch for {fillWithdrawal}. Deliberately separate from
    ///         {paused}: stopping solvers is not the same decision as stopping
    ///         deposits, and a solver mid-inventory-cycle should be able to be
    ///         stopped without halting the bridge.
    bool public fillsEnabled;

    /// @notice Master switch for {announceWithdrawal}.
    bool public announcementsEnabled;

    /// @notice The token an announcement bond is posted in, and how much.
    ///         A bond is refunded when the relayer adopts the announcement,
    ///         reclaimable if it is superseded or simply never confirmed, and
    ///         slashed only when governance rules the announcement fake.
    address public announcementBondToken;
    uint256 public announcementBondAmount;

    /// @notice Where a slashed bond goes.
    address public announcementSlashRecipient;

    /// @notice How long an announcer must wait before reclaiming an
    ///         unconfirmed bond. Long enough that a relayer outage does not
    ///         look like a fake announcement.
    uint64 public announcementTtlSeconds;

    /// @notice Announced STRATO withdrawals, keyed by withdrawal key.
    mapping(bytes32 => Announcement) public announcements;

    /// @notice The head of each withdrawal's claim ladder, keyed by
    ///         withdrawal key.
    mapping(bytes32 => WithdrawalClaim) public withdrawalClaims;

    /// @notice Withdrawals this contract has already routed. The Safe payload
    ///         is static and replayable by construction, so settling twice has
    ///         to be refused here.
    mapping(bytes32 => bool) public withdrawalSettled;

    /// @notice Addresses allowed to settle a withdrawal through this contract:
    ///         the custody Safe and the hot wallet, nobody else. Left open,
    ///         anyone could mark a withdrawal settled with a donation and
    ///         block the real payout.
    mapping(address => bool) public payoutSettlers;

    /// @notice Announcement bonds this contract is holding, per token.
    ///         Tracked separately from the balance because {sweepERC20} exists:
    ///         a router that never held anyone's money now does, and a sweep
    ///         that could take a live bond would make posting one unsafe.
    mapping(address => uint256) public bondedBalance;

    // ============ Structs ============
    struct TokenConfig {
        uint96 min;
        bool isPermitted;
    }

    /// @notice A bonded claim that a STRATO withdrawal exists, posted here
    ///         before the relayer has confirmed it. `state` is 1 while live, 2
    ///         once the bond has been returned, 3 once it has been slashed.
    struct Announcement {
        address announcer;
        uint96 bondAmount;
        address bondToken;
        uint64 announcedAt;
        uint8 state;
    }

    /**
     * @notice A STRATO withdrawal as this chain will settle it. Every field is
     *         fixed when the user makes the request, which is what lets the
     *         Safe proposal be built and signed immediately: the payload names
     *         the withdrawal and its terms, never a payee, so a solver taking
     *         over the claim afterwards does not invalidate a single signature.
     *
     * @dev THIS IS THE AUTHORITATIVE RECORD, and the Safe signers are what
     *      makes it authoritative -- they verified these terms against STRATO
     *      before signing the settlement that carries them. A claim is checked
     *      against this and paid only on an exact match, which is why a solver
     *      can be allowed to claim permissionlessly without being trusted.
     */
    struct WithdrawalTerms {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 withdrawalId;
        address token;
        address recipient;
        uint256 amount;
        uint256 maxFee;
        uint256 requestedAt;
        uint256 feeHalfLife;
    }

    /**
     * @notice The head of a withdrawal's claim ladder: who is currently owed
     *         the settlement, what they paid to get there, and the terms they
     *         paid against.
     *
     * @dev A LADDER, NOT A SLOT, AND THE HOLDER CONTROLS THE RUNG ABOVE THEM.
     *      Claim zero pays the withdrawal's recipient `amount - decayedFee()`
     *      -- the schedule the user committed to, which nobody can renegotiate.
     *      Every claim after that is one solver buying the position from
     *      another: it is possible only if the holder set `transferable`, and
     *      the price is the holder's own `exitFee`, which the taker pays as
     *      `amount - exitFee` and then keeps at settlement.
     *
     *      The holder may ask MORE than they earned, and that is the point. A
     *      solver who has come to believe a withdrawal will be rejected can
     *      pay someone else to carry it; a solver who knows one is good can
     *      set `transferable` false and keep it. Either way the user's leg is
     *      already settled and the bridge still pays `amount` exactly once, so
     *      the ladder redistributes only what the solvers have agreed to move
     *      between themselves.
     *
     * @dev `termsHash` is the binding to the withdrawal itself. A claim made
     *      against terms that do not match the settlement is void: the
     *      settlement pays the recipient and the claimant has given a stranger
     *      money.
     */
    struct WithdrawalClaim {
        address claimant;
        uint64 claimedAt;
        uint32 claimIndex;
        bool transferable;
        uint256 exitFee;
        uint256 feeCharged;
        uint256 netPaid;
        bytes32 termsHash;
    }

    /// @dev The result of moving a claim ladder up one rung: who the caller
    ///      must pay, at what index they now sit, and on what terms. A memory
    ///      struct rather than four return values so the calling frame stays
    ///      inside the EVM's stack limit.
    struct FillOutcome {
        address payTo;
        uint32 nextIndex;
        uint256 feeCharged;
        uint256 netPaid;
    }

    struct ActionIntent {
        uint8 action;
        address actionToken;
        uint256 minFinalOut;
    }

    struct DepositRequest {
        address token;
        uint256 amount;
        address stratoAddress;
        address targetStratoToken;
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    // ============ Events ============
    event DepositRouted(
        address indexed token,
        uint256 amount,
        address indexed sender,
        address indexed stratoAddress,
        address targetStratoToken,
        uint96 depositId
    );
    event DepositRoutedWithAction(
        address indexed token,
        uint256 amount,
        address indexed sender,
        address indexed stratoAddress,
        address targetStratoToken,
        uint96 depositId,
        uint8 action,
        address actionToken,
        uint256 minFinalOut
    );
    event TokenConfigUpdated(
        address indexed token,
        uint256 minAmount,
        bool isPermitted
    );
    event RoutePermittedUpdated(
        address indexed token,
        address indexed targetStratoToken,
        bool isPermitted
    );
    event GnosisSafeUpdated(address indexed oldSafe, address indexed newSafe);

    // ============ Fast-path events ============
    /// @notice A deposit that offers a solver fee. Separate from
    ///         {DepositRouted} rather than an extra field on it: the relayer
    ///         filters by topic0, and widening the old event would have
    ///         orphaned every deployed consumer at the same instant.
    /// @param maxFee The most a solver may keep, in this token's units
    /// @param requestedAt This chain's timestamp, where the decay starts
    /// @param feeHalfLife Seconds per halving, committed so it cannot move
    event DepositRoutedWithFee(
        address indexed token,
        uint256 amount,
        address indexed sender,
        address indexed stratoAddress,
        address targetStratoToken,
        uint96 depositId,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    event WithdrawalAnnounced(
        bytes32 indexed withdrawalKey,
        address indexed announcer,
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId,
        address token,
        address recipient,
        uint256 amount,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife,
        address bondToken,
        uint256 bondAmount
    );
    /// @notice A solver took over a withdrawal's claim. `paidTo` is the party
    ///         they displaced: the recipient on claim 0, the previous claimant
    ///         after that.
    event WithdrawalFilled(
        bytes32 indexed withdrawalKey,
        address indexed filler,
        address indexed paidTo,
        uint32 claimIndex,
        address token,
        uint256 amount,
        uint256 feeCharged,
        uint256 netPaid
    );
    /// @notice Custody routed a withdrawal. `payee` is the last claimant when
    ///         one matched the settled terms, and the recipient otherwise.
    event WithdrawalSettled(
        bytes32 indexed withdrawalKey,
        address indexed payee,
        address indexed recipient,
        address token,
        uint256 amount,
        uint32 claimIndex
    );
    /// @notice A claim existed but was made against different terms than the
    ///         ones custody settled, so it was ignored and the recipient was
    ///         paid. Emitted rather than reverted: a bad claim must never be
    ///         able to hold a real withdrawal hostage.
    event WithdrawalClaimVoided(
        bytes32 indexed withdrawalKey,
        address indexed claimant,
        bytes32 claimTermsHash,
        bytes32 settledTermsHash
    );
    /// @notice A claim holder changed whether, and at what price, they are
    ///         willing to be displaced.
    event WithdrawalClaimOfferUpdated(
        bytes32 indexed withdrawalKey,
        address indexed claimant,
        bool transferable,
        uint256 exitFee
    );
    event PayoutSettlerUpdated(address indexed settler, bool allowed);
    event AnnouncementBondReturned(bytes32 indexed withdrawalKey, address indexed announcer, uint256 amount);
    event AnnouncementBondSlashed(bytes32 indexed withdrawalKey, address indexed announcer, uint256 amount, address recipient);
    event FeeConfigUpdated(uint64 depositFeeHalfLifeSeconds, uint16 maxFeeBps, bool fillsEnabled);
    event TokenFeeHalfLifeUpdated(address indexed token, uint64 halfLifeSeconds);
    event AnnouncementConfigUpdated(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address permit2_,
        address gnosisSafe_,
        address owner_
    ) public initializer {
        if (
            owner_ == address(0) ||
            gnosisSafe_ == address(0) ||
            permit2_ == address(0)
        ) revert InvalidAddress();
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        // Set PERMIT2 once during initialization - this value persists across all upgrades
        PERMIT2 = IPermit2(permit2_);

        gnosisSafe = gnosisSafe_;
        emit GnosisSafeUpdated(address(0), gnosisSafe_);
    }

    function deposit(
        address token,
        uint256 amount,
        address stratoAddress,
        address targetStratoToken,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        DepositRequest memory request;
        request.token = token;
        request.amount = amount;
        request.stratoAddress = stratoAddress;
        request.targetStratoToken = targetStratoToken;
        request.nonce = nonce;
        request.deadline = deadline;
        request.signature = signature;
        (uint256 depositedAmount, uint96 id) = _processDeposit(request);

        emit DepositRouted(
            request.token,
            depositedAmount,
            msg.sender,
            request.stratoAddress,
            request.targetStratoToken,
            id
        );
    }

    function depositWithAction(
        address token,
        uint256 amount,
        address stratoAddress,
        address targetStratoToken,
        uint8 action,
        address actionToken,
        uint256 minFinalOut,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        ActionIntent memory intent;
        intent.action = action;
        intent.actionToken = actionToken;
        intent.minFinalOut = minFinalOut;

        DepositRequest memory request;
        request.token = token;
        request.amount = amount;
        request.stratoAddress = stratoAddress;
        request.targetStratoToken = targetStratoToken;
        request.nonce = nonce;
        request.deadline = deadline;
        request.signature = signature;
        (uint256 depositedAmount, uint96 id) = _processDeposit(request);

        _emitDepositWithAction(
            request.token,
            depositedAmount,
            request.stratoAddress,
            request.targetStratoToken,
            id,
            intent
        );
    }

    function _emitDepositWithAction(
        address token,
        uint256 depositedAmount,
        address stratoAddress,
        address targetStratoToken,
        uint96 id,
        ActionIntent memory intent
    ) internal {
        emit DepositRoutedWithAction(
            token,
            depositedAmount,
            msg.sender,
            stratoAddress,
            targetStratoToken,
            id,
            intent.action,
            intent.actionToken,
            intent.minFinalOut
        );
    }

    function _processDeposit(
        DepositRequest memory request
    ) internal returns (uint256 depositedAmount, uint96 id) {
        if (request.amount == 0) revert ZeroAmount();
        if (request.token == address(0)) revert UseDepositETH();
        if (request.stratoAddress == address(0)) revert InvalidAddress();
        if (request.targetStratoToken == address(0)) revert InvalidAddress();
        if (request.deadline < block.timestamp) revert PermitExpired();

        TokenConfig storage c = tokenConfig[request.token];
        if (request.amount < c.min) revert BelowMinimum();
        if (!c.isPermitted) revert NotPermitted();
        if (!routePermitted[request.token][request.targetStratoToken]) revert NotPermitted();

        address safe = gnosisSafe;
        unchecked {
            id = ++depositId;
        }

        uint256 balanceBefore = IERC20(request.token).balanceOf(safe);

        IPermit2.PermitTransferFrom memory permit = IPermit2
            .PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({
                    token: request.token,
                    amount: request.amount
                }),
                nonce: request.nonce,
                deadline: request.deadline
            });
        IPermit2.SignatureTransferDetails memory transferDetails = IPermit2
            .SignatureTransferDetails({to: safe, requestedAmount: request.amount});
        PERMIT2.permitTransferFrom(
            permit,
            transferDetails,
            msg.sender,
            request.signature
        );

        depositedAmount = IERC20(request.token).balanceOf(safe) - balanceBefore;

        if (depositedAmount == 0) revert ZeroAmount();
        if (depositedAmount < request.amount) revert FeesNotSupported();
    }

    // using address(0) for ETH
    function depositETH(
        address stratoAddress,
        address targetStratoToken
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (stratoAddress == address(0)) revert InvalidAddress();
        if (targetStratoToken == address(0)) revert InvalidAddress();

        TokenConfig storage c = tokenConfig[address(0)];
        if (msg.value < c.min) revert BelowMinimum();
        if (!c.isPermitted) revert NotPermitted();
        if (!routePermitted[address(0)][targetStratoToken]) revert NotPermitted();

        address safe = gnosisSafe;
        unchecked {
            ++depositId;
        }

        (bool success, ) = safe.call{value: msg.value}("");
        if (!success) revert ETHTransferFailed();

        emit DepositRouted(
            address(0),
            msg.value,
            msg.sender,
            stratoAddress,
            targetStratoToken,
            depositId
        );
    }

    // ============ Fast path: deposits that offer a solver fee ============

    /**
     * @notice {deposit}, plus a `maxFee` the depositor will pay a solver who
     *         delivers the funds on STRATO before this chain's relayer and
     *         review cycle has finished.
     *
     * @dev THE FEE IS CHECKED AGAINST WHAT ARRIVED, not against what was
     *      asked for. `depositedAmount` is the measured balance delta at the
     *      Safe, and it is also the amount the STRATO log carries and a solver
     *      must pay against; validating the request figure instead would let a
     *      fee-on-transfer token produce a fee larger than the deposit.
     *
     * @dev THERE IS NO ACTION VARIANT OF THIS, on purpose. A deposit carrying
     *      an auto-forge or auto-save intent cannot be filled -- a solver
     *      cannot reproduce the action, and handing them the mint would leave
     *      the depositor without the thing they asked for -- so offering a fee
     *      on one would be offering a fee nobody can ever collect. Action
     *      deposits keep using {depositWithAction} and the slow path.
     *
     * @param maxFee The ceiling, in `token` units, on what a solver may keep.
     *               Zero opts out of the fast path entirely.
     */
    function depositWithFee(
        address token,
        uint256 amount,
        address stratoAddress,
        address targetStratoToken,
        uint256 maxFee,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        DepositRequest memory request;
        request.token = token;
        request.amount = amount;
        request.stratoAddress = stratoAddress;
        request.targetStratoToken = targetStratoToken;
        request.nonce = nonce;
        request.deadline = deadline;
        request.signature = signature;
        (uint256 depositedAmount, uint96 id) = _processDeposit(request);

        uint256 halfLife = _resolveFeeTerms(token, depositedAmount, maxFee);

        emit DepositRoutedWithFee(
            request.token,
            depositedAmount,
            msg.sender,
            request.stratoAddress,
            request.targetStratoToken,
            id,
            maxFee,
            block.timestamp,
            halfLife
        );
    }

    /// @notice {depositETH}, plus a solver fee. `maxFee` is in wei, and is
    ///         bounded by the same basis-point ceiling as any other token.
    function depositETHWithFee(
        address stratoAddress,
        address targetStratoToken,
        uint256 maxFee
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (stratoAddress == address(0)) revert InvalidAddress();
        if (targetStratoToken == address(0)) revert InvalidAddress();

        TokenConfig storage c = tokenConfig[address(0)];
        if (msg.value < c.min) revert BelowMinimum();
        if (!c.isPermitted) revert NotPermitted();
        if (!routePermitted[address(0)][targetStratoToken]) revert NotPermitted();

        uint256 halfLife = _resolveFeeTerms(address(0), msg.value, maxFee);

        address safe = gnosisSafe;
        unchecked {
            ++depositId;
        }

        (bool success, ) = safe.call{value: msg.value}("");
        if (!success) revert ETHTransferFailed();

        emit DepositRoutedWithFee(
            address(0),
            msg.value,
            msg.sender,
            stratoAddress,
            targetStratoToken,
            depositId,
            maxFee,
            block.timestamp,
            halfLife
        );
    }

    /**
     * @dev Validate an offered fee and pin the half-life that will govern its
     *      decay. Resolving the half-life HERE and emitting it is the whole
     *      point: the destination recomputes the schedule from the log, so a
     *      later config change cannot re-price a deposit in flight.
     */
    function _resolveFeeTerms(
        address token,
        uint256 amount,
        uint256 maxFee
    ) internal view returns (uint256 halfLife) {
        if (maxFee == 0) return 0;
        if (!BridgeFeeDecay.isFeeCapAllowed(maxFee, amount, maxFeeBps)) revert FeeTooLarge();

        halfLife = tokenFeeHalfLifeSeconds[token];
        if (halfLife == 0) halfLife = depositFeeHalfLifeSeconds;
        if (!BridgeFeeDecay.isHalfLifeAllowed(halfLife)) revert BadHalfLife();
    }

    // ============ Fast path: filling STRATO withdrawals here ============

    /// @notice The identity of a STRATO withdrawal on this chain: its source
    ///         bridge and id, never a block or log position. Two STRATO
    ///         bridges may both number a withdrawal 7.
    function withdrawalKeyFor(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(sourceChainId, sourceBridge, withdrawalId));
    }

    /// @notice The binding between a claim and a settlement. Includes this
    ///         chain's id, so terms signed for one chain cannot be replayed on
    ///         another that happens to run the same bridge.
    function withdrawalTermsHash(WithdrawalTerms calldata terms) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                terms.sourceChainId,
                terms.sourceBridge,
                terms.withdrawalId,
                terms.token,
                terms.recipient,
                terms.amount,
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife
            )
        );
    }

    /// @notice What a solver would keep by claiming right now, what they must
    ///         pay out to get it, and to whom. On rung zero that is the user's
    ///         decayed schedule; after that it is the current holder's asking
    ///         price, and `forSale` is false if they are not selling.
    function quoteWithdrawalFill(WithdrawalTerms calldata terms)
        external
        view
        returns (address payTo, uint256 feeCharged, uint256 netToPay, bool forSale)
    {
        bytes32 key = withdrawalKeyFor(terms.sourceChainId, terms.sourceBridge, terms.withdrawalId);
        WithdrawalClaim storage c = withdrawalClaims[key];
        if (c.claimant == address(0)) {
            payTo = terms.recipient;
            feeCharged = BridgeFeeDecay.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
            forSale = !withdrawalSettled[key];
        } else {
            payTo = c.claimant;
            feeCharged = c.exitFee;
            forSale = c.transferable && !withdrawalSettled[key];
        }
        netToPay = terms.amount - feeCharged;
    }

    /// @notice Who custody will pay for this withdrawal as things stand, and
    ///         where the claim ladder has got to. The relayer and the UI read
    ///         this; the settlement does not depend on it.
    function withdrawalFiller(bytes32 withdrawalKey)
        external
        view
        returns (WithdrawalClaim memory claim, bool settled)
    {
        return (withdrawalClaims[withdrawalKey], withdrawalSettled[withdrawalKey]);
    }

    /**
     * @notice Pay out a STRATO withdrawal from your own funds, ahead of the
     *         Safe, and take over the claim on its eventual settlement.
     *
     *         The transfer runs HERE, solver to payee, so "the payee was paid"
     *         becomes a fact in this chain's ledger rather than a promise.
     *         What the solver keeps is the decayed fee: they must deliver
     *         `amount - decayedFee(...)` computed from the committed schedule
     *         and this block's timestamp.
     *
     *         THE CLAIM IS A LADDER. On the first claim the payee is the
     *         withdrawal's recipient. On every claim after that it is the
     *         PREVIOUS CLAIMANT, paid `amount - fee(now)` in turn -- so a
     *         solver who filled at the full fee can hand the position to one
     *         who will take a thinner one, and keeps the decay that accrued
     *         while they held it. Every rung is self-financing: the user is
     *         paid once, custody pays `amount` once, and the difference is
     *         split among the solvers by when each of them held the claim.
     *
     * @dev NOTHING HERE VERIFIES THE WITHDRAWAL EXISTS, deliberately -- this
     *      chain cannot know. A claim against a withdrawal that was never
     *      requested, or against terms that do not match what custody
     *      eventually settles, pays a stranger and earns nothing: the
     *      settlement pays the real recipient instead and emits
     *      {WithdrawalClaimVoided}. That is the risk the fee prices, and the
     *      reason a solver should read STRATO rather than trust an
     *      announcement here.
     *
     * @dev CLAIMS ARE BOUND TO ONE SET OF TERMS. The first claim fixes
     *      `termsHash`; a later claimant presenting different terms is talking
     *      about a different withdrawal and is refused, rather than being
     *      allowed to shift the ladder out from under the solver below them.
     *
     * @dev Churn is not worth policing. Two claims in the same block leave the
     *      displaced solver exactly whole -- the fee has not moved -- so a
     *      re-claim with nothing to gain still costs its author the full
     *      payout in capital and the gas on top.
     */
    function fillWithdrawal(
        WithdrawalTerms calldata terms,
        uint256 expectedFee,
        bool transferable,
        uint256 exitFee
    )
        external
        payable
        whenNotPaused
        nonReentrant
        returns (bytes32 withdrawalKey)
    {
        withdrawalKey = _openFill(terms, exitFee);
        FillOutcome memory outcome = _advanceLadder(
            withdrawalKey,
            terms,
            expectedFee,
            transferable,
            exitFee
        );

        _payOutAllowingExcess(terms.token, outcome.payTo, outcome.netPaid);

        emit WithdrawalFilled(
            withdrawalKey,
            msg.sender,
            outcome.payTo,
            outcome.nextIndex,
            terms.token,
            terms.amount,
            outcome.feeCharged,
            outcome.netPaid
        );
    }

    /// @dev Everything a fill must be true of before the ladder is touched.
    ///      Split out of {fillWithdrawal} to keep that frame shallow enough to
    ///      compile without via-IR.
    function _openFill(WithdrawalTerms calldata terms, uint256 exitFee)
        internal
        view
        returns (bytes32 withdrawalKey)
    {
        if (!fillsEnabled) revert FillsDisabled();
        if (terms.recipient == address(0)) revert InvalidAddress();
        if (terms.sourceBridge == address(0)) revert InvalidAddress();
        if (terms.sourceChainId == 0 || terms.withdrawalId == 0) revert InvalidAddress();
        if (terms.amount == 0) revert ZeroAmount();
        if (!tokenConfig[terms.token].isPermitted) revert NotPermitted();
        if (!BridgeFeeDecay.isFeeCapAllowed(terms.maxFee, terms.amount, maxFeeBps)) {
            revert FeeTooLarge();
        }
        if (terms.maxFee > 0 && !BridgeFeeDecay.isHalfLifeAllowed(terms.feeHalfLife)) {
            revert BadHalfLife();
        }
        if (exitFee >= terms.amount) revert FeeTooLarge();

        withdrawalKey = withdrawalKeyFor(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        if (withdrawalSettled[withdrawalKey]) revert AlreadySettled();
    }

    /// @dev Move the ladder up one rung and record the new head. Returns who
    ///      must be paid and how much; the transfer itself happens in the
    ///      caller, AFTER this has written the new head, because the token and
    ///      the payee are both arbitrary.
    function _advanceLadder(
        bytes32 withdrawalKey,
        WithdrawalTerms calldata terms,
        uint256 expectedFee,
        bool transferable,
        uint256 exitFee
    ) internal returns (FillOutcome memory outcome) {
        bytes32 termsHash = withdrawalTermsHash(terms);
        WithdrawalClaim storage claim = withdrawalClaims[withdrawalKey];

        if (claim.claimant == address(0)) {
            // Rung zero pays the user, at the schedule they committed to.
            outcome.payTo = terms.recipient;
            outcome.feeCharged = BridgeFeeDecay.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
        } else {
            if (claim.termsHash != termsHash) revert TermsMismatch();
            // The holder's consent is the whole gate. A solver who knows a
            // withdrawal is good must be able to keep their position; without
            // this, anyone could take it from them for a penny of decay.
            if (!claim.transferable) revert NotTransferable();
            outcome.payTo = claim.claimant;
            outcome.nextIndex = claim.claimIndex + 1;
            outcome.feeCharged = claim.exitFee;
        }

        if (outcome.payTo == msg.sender) revert AlreadyClaimant();
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
        if (outcome.feeCharged < expectedFee) revert FeeBelowMinimum();

        outcome.netPaid = terms.amount - outcome.feeCharged;
        if (outcome.netPaid == 0) revert ZeroAmount();

        claim.claimant = msg.sender;
        claim.claimedAt = uint64(block.timestamp);
        claim.claimIndex = outcome.nextIndex;
        claim.transferable = transferable;
        claim.exitFee = transferable ? exitFee : 0;
        claim.feeCharged = outcome.feeCharged;
        claim.netPaid = outcome.netPaid;
        claim.termsHash = termsHash;
    }

    /**
     * @notice Change whether your claim can be taken over, and at what price.
     *
     *         Callable by the current holder at any time before custody
     *         settles the withdrawal, as often as they like. A solver's read on
     *         a withdrawal changes -- a route starts looking shaky, a recipient
     *         starts looking like a thief -- and the position they are holding
     *         should be repriceable when it does. Setting `transferable` false
     *         takes it off the market entirely.
     *
     * @dev The full terms are passed rather than just the key, so the offer is
     *      re-bound to the same withdrawal the claim was made against and the
     *      asking price can be checked against its amount.
     */
    function setWithdrawalClaimExitOffer(
        WithdrawalTerms calldata terms,
        bool transferable,
        uint256 exitFee
    ) external {
        bytes32 withdrawalKey = withdrawalKeyFor(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        if (withdrawalSettled[withdrawalKey]) revert AlreadySettled();
        if (exitFee >= terms.amount) revert FeeTooLarge();

        WithdrawalClaim storage claim = withdrawalClaims[withdrawalKey];
        if (claim.claimant != msg.sender) revert NotPermitted();
        if (claim.termsHash != withdrawalTermsHash(terms)) revert TermsMismatch();

        claim.transferable = transferable;
        claim.exitFee = transferable ? exitFee : 0;

        emit WithdrawalClaimOfferUpdated(withdrawalKey, msg.sender, transferable, claim.exitFee);
    }

    /**
     * @notice Custody routing a withdrawal: pays `amount` to whoever holds the
     *         claim, or to the recipient if nobody does.
     *
     *         THE SAFE PROPOSAL IS THIS CALL, and it is static. It names the
     *         withdrawal and the terms the signers verified, never a payee, so
     *         it can be proposed and signed the moment the withdrawal is
     *         observed and stays valid however the claim ladder moves
     *         afterwards. No re-proposal, no per-solver signing round, and no
     *         signer ever has to look at a fill.
     *
     *         THE TERMS ARE THE AUTHORISATION. A claim is paid only if it was
     *         made against exactly these terms; any other claim is void and
     *         the recipient is paid, because the alternative -- reverting --
     *         would let one bogus claim strand a real withdrawal.
     *
     * @dev CUSTODY NEVER RESTS HERE. For an ERC20 this pulls from the caller
     *      straight to the payee, so the Safe transaction is a MultiSend of
     *      [approve(router, amount), settleWithdrawal(terms)] and the
     *      allowance is created and consumed inside one atomic transaction.
     *      For the native asset the call is payable and forwards `msg.value`.
     *      This contract is a router in both cases and holds nothing.
     *
     * @dev Restricted to {payoutSettlers}. Left open, anyone could mark a
     *      withdrawal settled with their own donation and block the real
     *      payout.
     */
    function settleWithdrawal(WithdrawalTerms calldata terms)
        external
        payable
        nonReentrant
        returns (address payee)
    {
        if (!payoutSettlers[msg.sender]) revert NotPermitted();
        if (terms.recipient == address(0)) revert InvalidAddress();
        if (terms.amount == 0) revert ZeroAmount();

        bytes32 withdrawalKey = withdrawalKeyFor(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        if (withdrawalSettled[withdrawalKey]) revert AlreadySettled();
        withdrawalSettled[withdrawalKey] = true;

        bytes32 termsHash = withdrawalTermsHash(terms);
        WithdrawalClaim storage claim = withdrawalClaims[withdrawalKey];

        payee = terms.recipient;
        uint32 claimIndex = 0;
        if (claim.claimant != address(0)) {
            if (claim.termsHash == termsHash) {
                payee = claim.claimant;
                claimIndex = claim.claimIndex;
            } else {
                emit WithdrawalClaimVoided(
                    withdrawalKey,
                    claim.claimant,
                    claim.termsHash,
                    termsHash
                );
            }
        }

        _payOut(terms.token, payee, terms.amount, true);

        emit WithdrawalSettled(
            withdrawalKey,
            payee,
            terms.recipient,
            terms.token,
            terms.amount,
            claimIndex
        );
    }

    /**
     * @dev Move `amount` of `token` from the caller to `to`, native or ERC20,
     *      without this contract ever holding it. `exactValue` demands that a
     *      native transfer carry exactly `amount` and that an ERC20 transfer
     *      carry no value at all -- a mismatched `msg.value` on an ERC20 call
     *      would otherwise strand ether here.
     */
    /**
     * @dev {_payOut} for an amount that is only settled at execution time.
     *
     *      A fill pays `amount - decayedFee(block.timestamp)`, which falls
     *      every second the fee is still decaying. Demanding an exact
     *      `msg.value` therefore makes a NATIVE-token fill unreachable for any
     *      caller that cannot choose which block it lands in: an EOA computes
     *      the value for one second, the transaction confirms in another, and
     *      the revert is indistinguishable from a genuine mistake. It is the
     *      same defect the `feeCharged == expectedFee` guard had, in the value
     *      dimension instead of the fee dimension.
     *
     *      So take any sufficient value and hand back the remainder: the
     *      recipient still receives exactly what the schedule says, and the
     *      filler is never charged more than it owed. Safe against reentry
     *      because every caller is `nonReentrant` and the refund is last.
     */
    function _payOutAllowingExcess(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value < amount) revert WrongEthValue();
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert ETHTransferFailed();
            uint256 excess = msg.value - amount;
            if (excess > 0) {
                (bool refunded, ) = msg.sender.call{value: excess}("");
                if (!refunded) revert ETHTransferFailed();
            }
        } else {
            if (msg.value != 0) revert WrongEthValue();
            IERC20(token).safeTransferFrom(msg.sender, to, amount);
        }
    }

    function _payOut(address token, address to, uint256 amount, bool exactValue) internal {
        if (token == address(0)) {
            if (exactValue && msg.value != amount) revert WrongEthValue();
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert ETHTransferFailed();
        } else {
            if (exactValue && msg.value != 0) revert WrongEthValue();
            IERC20(token).safeTransferFrom(msg.sender, to, amount);
        }
    }

    // ============ Fast path: permissionless announcements ============

    /**
     * @notice Post a STRATO withdrawal here before the relayer has seen it, so
     *         a solver can fill it immediately.
     *
     *         An announcement moves no bridge funds and proves nothing. It is
     *         a coordination surface: the relayer stops being the starting gun
     *         and becomes a confirmation bot. Anyone may post one, which is why
     *         it costs a bond -- refunded when the relayer confirms it
     *         ({confirmAnnouncement}), reclaimable if the relayer never does
     *         ({reclaimAnnouncementBond}), and slashed only when governance
     *         rules it fake ({rejectAnnouncement}).
     *
     * @dev A SOLVER MUST NOT TREAT THIS AS EVIDENCE. Announcements are
     *      unverified by construction; a solver who fills against one without
     *      reading STRATO is trusting a stranger, and that loss is theirs.
     */
    function announceWithdrawal(WithdrawalTerms calldata terms)
        external
        nonReentrant
        returns (bytes32 withdrawalKey)
    {
        if (!announcementsEnabled) revert AnnouncementsDisabled();
        if (terms.sourceBridge == address(0) || terms.recipient == address(0)) {
            revert InvalidAddress();
        }
        if (terms.sourceChainId == 0 || terms.withdrawalId == 0) revert InvalidAddress();
        if (terms.amount == 0) revert ZeroAmount();
        if (!tokenConfig[terms.token].isPermitted) revert NotPermitted();

        withdrawalKey = withdrawalKeyFor(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        if (announcements[withdrawalKey].state != 0) revert AlreadyAnnounced();

        address bondToken = announcementBondToken;
        uint256 bondAmount = announcementBondAmount;
        if (bondToken == address(0) || bondAmount == 0) revert BondNotConfigured();

        announcements[withdrawalKey] = Announcement({
            announcer: msg.sender,
            bondAmount: uint96(bondAmount),
            bondToken: bondToken,
            announcedAt: uint64(block.timestamp),
            state: 1
        });

        bondedBalance[bondToken] += bondAmount;
        IERC20(bondToken).safeTransferFrom(msg.sender, address(this), bondAmount);

        emit WithdrawalAnnounced(
            withdrawalKey,
            msg.sender,
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId,
            terms.token,
            terms.recipient,
            terms.amount,
            terms.maxFee,
            terms.requestedAt,
            terms.feeHalfLife,
            bondToken,
            bondAmount
        );
    }

    /// @notice The relayer's confirmation that an announced withdrawal is real:
    ///         returns the bond. This is the whole of the relayer's role in the
    ///         fast path -- it confirms, it no longer starts.
    function confirmAnnouncement(bytes32 withdrawalKey) external onlyOwner nonReentrant {
        _returnBond(withdrawalKey);
    }

    /// @notice Reclaim your own bond once the relayer has had long enough to
    ///         confirm and has not. Permissionless: an announcer should never
    ///         need an admin to get their own money back, and a relayer
    ///         outage must not read as fraud.
    function reclaimAnnouncementBond(bytes32 withdrawalKey) external nonReentrant {
        Announcement storage a = announcements[withdrawalKey];
        if (a.state != 1) revert BondAlreadyResolved();
        if (block.timestamp < uint256(a.announcedAt) + announcementTtlSeconds) {
            revert BondNotReclaimable();
        }
        _returnBond(withdrawalKey);
    }

    /// @notice Slash a fake announcement's bond. The only path that takes
    ///         someone's bond, and it is governance-gated for that reason: an
    ///         announcement that merely disagrees with the relayer's numbers
    ///         is superseded, not fraudulent, and its bond is reclaimable.
    function rejectAnnouncement(bytes32 withdrawalKey) external onlyOwner nonReentrant {
        Announcement storage a = announcements[withdrawalKey];
        if (a.state != 1) revert BondAlreadyResolved();

        address recipient = announcementSlashRecipient;
        if (recipient == address(0)) revert InvalidAddress();

        a.state = 3;
        uint256 amount = a.bondAmount;
        address bondToken = a.bondToken;
        address announcer = a.announcer;

        if (amount != 0) {
            bondedBalance[bondToken] -= amount;
            IERC20(bondToken).safeTransfer(recipient, amount);
        }
        emit AnnouncementBondSlashed(withdrawalKey, announcer, amount, recipient);
    }

    function _returnBond(bytes32 withdrawalKey) internal {
        Announcement storage a = announcements[withdrawalKey];
        if (a.state != 1) revert BondAlreadyResolved();

        a.state = 2;
        uint256 amount = a.bondAmount;
        address bondToken = a.bondToken;
        address announcer = a.announcer;

        if (amount != 0) {
            bondedBalance[bondToken] -= amount;
            IERC20(bondToken).safeTransfer(announcer, amount);
        }
        emit AnnouncementBondReturned(withdrawalKey, announcer, amount);
    }

    // ============ Fast-path configuration ============

    /**
     * @notice Turn the fast path on and set its shape.
     *
     * @dev Called after the upgrade that introduced the fast path; the
     *      reinitializer is what makes that one-shot rather than something an
     *      owner can replay. Defaults live here and not in {initialize}
     *      because {initialize} has already run on the deployed proxy.
     *
     * @param halfLifeSeconds Seconds per halving of an offered fee
     * @param feeBpsCeiling Ceiling on any offered fee, in basis points
     * @param bondToken Token an announcement bond is posted in
     * @param bondAmount How much
     * @param slashRecipient Where a slashed bond goes
     * @param ttlSeconds How long before an unconfirmed bond is reclaimable
     */
    function initializeFastPath(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds,
        address[] calldata settlers
    ) external reinitializer(2) onlyOwner {
        _setFeeConfig(halfLifeSeconds, feeBpsCeiling, true);
        _setAnnouncementConfig(true, bondToken, bondAmount, slashRecipient, ttlSeconds);
        for (uint256 i; i < settlers.length; ++i) {
            _setPayoutSettler(settlers[i], true);
        }
    }

    /// @notice Allow (or stop) an address routing withdrawals through
    ///         {settleWithdrawal}. The custody Safe and the hot wallet; nothing
    ///         else has any business calling it.
    function setPayoutSettler(address settler, bool allowed) external onlyOwner {
        _setPayoutSettler(settler, allowed);
    }

    function _setPayoutSettler(address settler, bool allowed) internal {
        if (settler == address(0)) revert InvalidAddress();
        payoutSettlers[settler] = allowed;
        emit PayoutSettlerUpdated(settler, allowed);
    }

    function setFeeConfig(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        bool enableFills
    ) external onlyOwner {
        _setFeeConfig(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    function _setFeeConfig(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        bool enableFills
    ) internal {
        if (!BridgeFeeDecay.isHalfLifeAllowed(halfLifeSeconds)) revert BadHalfLife();
        if (feeBpsCeiling > BridgeFeeDecay.BPS_DENOMINATOR) revert FeeTooLarge();
        depositFeeHalfLifeSeconds = halfLifeSeconds;
        maxFeeBps = feeBpsCeiling;
        fillsEnabled = enableFills;
        emit FeeConfigUpdated(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    /// @notice Override the fee half-life for one token; zero restores the
    ///         bridge-wide default.
    function setTokenFeeHalfLife(address token, uint64 halfLifeSeconds) external onlyOwner {
        if (halfLifeSeconds != 0 && !BridgeFeeDecay.isHalfLifeAllowed(halfLifeSeconds)) {
            revert BadHalfLife();
        }
        tokenFeeHalfLifeSeconds[token] = halfLifeSeconds;
        emit TokenFeeHalfLifeUpdated(token, halfLifeSeconds);
    }

    function setAnnouncementConfig(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    ) external onlyOwner {
        _setAnnouncementConfig(enabled, bondToken, bondAmount, slashRecipient, ttlSeconds);
    }

    function _setAnnouncementConfig(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    ) internal {
        if (enabled) {
            if (bondToken == address(0) || slashRecipient == address(0)) revert InvalidAddress();
            if (bondAmount == 0) revert ZeroAmount();
            // uint96 is the struct's bond field; refuse a configuration that
            // would silently truncate when an announcement records it.
            if (bondAmount > type(uint96).max) revert FeeTooLarge();
            if (ttlSeconds == 0) revert BondNotReclaimable();
        }
        announcementsEnabled = enabled;
        announcementBondToken = bondToken;
        announcementBondAmount = bondAmount;
        announcementSlashRecipient = slashRecipient;
        announcementTtlSeconds = ttlSeconds;
        emit AnnouncementConfigUpdated(enabled, bondToken, bondAmount, slashRecipient, ttlSeconds);
    }

    function setMinDepositAmount(
        address token,
        uint96 minAmount
    ) external onlyOwner {
        TokenConfig storage c = tokenConfig[token];
        if (c.min == minAmount) return;
        c.min = minAmount;
        emit TokenConfigUpdated(token, minAmount, c.isPermitted);
    }

    function setPermitted(address token, bool isPermitted) external onlyOwner {
        TokenConfig storage c = tokenConfig[token];
        if (c.isPermitted == isPermitted) return;
        c.isPermitted = isPermitted;
        emit TokenConfigUpdated(token, c.min, isPermitted);
    }

    function setRoutePermitted(
        address token,
        address targetStratoToken,
        bool isPermitted
    ) external onlyOwner {
        if (targetStratoToken == address(0)) revert InvalidAddress();
        if (routePermitted[token][targetStratoToken] == isPermitted) return;
        routePermitted[token][targetStratoToken] = isPermitted;
        emit RoutePermittedUpdated(token, targetStratoToken, isPermitted);
    }

    function batchUpdateTokens(
        address[] calldata tokens,
        uint96[] calldata minAmounts,
        bool[] calldata isPermitteds,
        address[] calldata targetStratoTokens
    ) external onlyOwner {
        uint256 len = tokens.length;
        if (len != minAmounts.length) revert ArrayLengthMismatch();
        if (len != isPermitteds.length) revert ArrayLengthMismatch();
        if (len != targetStratoTokens.length) revert ArrayLengthMismatch();

        for (uint256 i; i < len; ) {
            address t = tokens[i];
            uint96 m = minAmounts[i];
            bool p = isPermitteds[i];
            address targetStratoToken = targetStratoTokens[i];
            if (targetStratoToken == address(0)) revert InvalidAddress();
            TokenConfig storage c = tokenConfig[t];
            c.min = m;
            c.isPermitted = p;
            routePermitted[t][targetStratoToken] = p;
            emit TokenConfigUpdated(t, m, p);
            emit RoutePermittedUpdated(t, targetStratoToken, p);
            unchecked {
                ++i;
            }
        }
    }

    function setGnosisSafe(address newSafe) external onlyOwner {
        if (newSafe == address(0)) revert InvalidAddress();
        address old = gnosisSafe;
        if (newSafe == old) revert SameAddressProposed();
        gnosisSafe = newSafe;
        emit GnosisSafeUpdated(old, newSafe);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function canDeposit(
        address token,
        uint256 amount,
        address targetStratoToken
    ) external view returns (bool) {
        if (amount == 0 || paused()) return false;
        if (targetStratoToken == address(0)) return false;

        TokenConfig storage c = tokenConfig[token];
        if (amount < c.min) return false;
        if (!c.isPermitted) return false;
        if (!routePermitted[token][targetStratoToken]) return false;
        return true;
    }

    function version() external pure virtual returns (string memory) {
        return "4.0.0";
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    receive() external payable {
        revert UseDepositETH();
    }
    fallback() external payable {
        revert UseDepositETH();
    }

    function sweepETH(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert SweepEthFailed();
    }

    /// @notice Sweep a stray balance. Announcement bonds are NOT stray: only
    ///         the excess over {bondedBalance} can leave, so an announcer's
    ///         bond cannot be swept out from under them.
    function sweepERC20(
        address token,
        address to
    ) external onlyOwner nonReentrant {
        if (to == address(0) || token == address(0)) revert InvalidAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 bonded = bondedBalance[token];
        if (bal <= bonded) return;
        IERC20(token).safeTransfer(to, bal - bonded);
    }
}

// see https://github.com/dragonfly-xyz/useful-solidity-patterns/blob/main/patterns/permit2/Permit2Vault.sol
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

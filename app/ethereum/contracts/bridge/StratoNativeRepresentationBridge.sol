// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "./StratoNativeRepresentationToken.sol";
import "./BridgeFeeDecay.sol";

/// @title StratoNativeRepresentationBridge
/// @notice Controls minting of external representation tokens and user-initiated redemption requests.
/// @notice Redemption is safe because the bridge first receives representation tokens from the user,
///         then burns only the tokens held by this contract, and finally emits a canonical event for relayers.
///
/// @notice SOLVER FAST PATH. A withdrawal out of STRATO normally waits for the
///         attestation signers and the custody Safe. {fillWithdrawal} lets a
///         solver hand the recipient their representation tokens immediately,
///         out of their own holdings, and take over the claim on the eventual
///         mint -- keeping a fee that decays exponentially to zero over three
///         days, so the fastest solver earns the most and a user nobody
///         rushed to serve is refunded the difference automatically.
///
/// @notice THE REDIRECT IS ENFORCED HERE, not arranged off-chain. The
///         attestation still names the original recipient and is still signed
///         and executed exactly as before; {mintRepresentationWithAttestationV2}
///         mints to whoever holds the claim instead, and only when that claim
///         was made against the same terms the signers attested to. The
///         signers therefore never see a fill, never re-sign, and cannot be
///         asked to bless one.
///
/// @notice Supply stays exact at every rung. A solver moves tokens that already
///         exist; the mint adds exactly the amount STRATO locked. Nothing about
///         the fast path changes how much of a representation token exists.
///
/// @dev WHAT THE FAST PATH DOES NOT DO: it does not skip the attestation
///      threshold, the notBefore delay, or the Safe. The solver waits for all
///      of it and carries the risk that the withdrawal is rejected or never
///      attested, which is what turns that risk into a quoted fee.
contract StratoNativeRepresentationBridge is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using BridgeFeeDecay for uint256;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MAPPING_ADMIN_ROLE = keccak256("MAPPING_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant ATTESTATION_ADMIN_ROLE = keccak256("ATTESTATION_ADMIN_ROLE");
    // There is deliberately NO separate mint-executor role. One existed
    // (MINT_EXECUTOR_ROLE, v1.1.0) so a relayer hot key could mint small
    // withdrawals without waiting for the custody Safe -- a makeshift fast
    // path. It also meant one key holding that role plus an attestation-signer
    // key could mint with no Safe proposal at all, which is how representation
    // supply once ran 4,000 ahead of what STRATO had locked. Solvers are the
    // fast path now, and they front their OWN inventory; minting is the slow
    // path and belongs to the bridge admin (the custody Safe) alone. A stale
    // grant of the old role hash on a live proxy confers nothing.
    bytes32 private constant NATIVE_MINT_ATTESTATION_TYPEHASH = keccak256(
        "NativeMintAttestation(uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline)"
    );

    /// @notice The V2 attestation: V1 plus the solver fee schedule.
    ///
    /// @dev THE SCHEDULE HAS TO BE ATTESTED, not passed by the solver. The
    ///      redirect is automatic, so a solver free to name their own `maxFee`
    ///      could pay the recipient a penny and collect the whole mint. These
    ///      three fields are what STRATO committed when the user made the
    ///      request; the signers copy them from the withdrawal record, and a
    ///      claim that priced itself against anything else is void.
    bytes32 private constant NATIVE_MINT_ATTESTATION_V2_TYPEHASH = keccak256(
        "NativeMintAttestationV2(uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline,uint256 maxFee,uint256 requestedAt,uint256 feeHalfLife)"
    );

    struct NativeMintAttestationV2 {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 destinationChainId;
        address destinationBridge;
        uint256 sourceWithdrawalId;
        address stratoToken;
        address representationToken;
        address recipient;
        uint256 amount;
        uint256 notBefore;
        uint256 deadline;
        uint256 maxFee;
        uint256 requestedAt;
        uint256 feeHalfLife;
    }

    /**
     * @notice A STRATO native withdrawal as this chain will settle it. Fixed
     *         when the user made the request, which is what lets a claim and
     *         an attestation be checked against each other without either
     *         having to know about the other.
     */
    struct WithdrawalTerms {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 withdrawalId;
        address stratoToken;
        address representationToken;
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

    /// @dev The result of moving a claim ladder up one rung. A memory struct
    ///      rather than four return values so the calling frame stays inside
    ///      the EVM's stack limit.
    struct FillOutcome {
        address payTo;
        uint32 nextIndex;
        uint256 feeCharged;
        uint256 netPaid;
    }

    /// @notice A bonded, unverified claim that a STRATO withdrawal exists,
    ///         posted here before the relayer has confirmed it.
    struct Announcement {
        address announcer;
        uint96 bondAmount;
        address bondToken;
        uint64 announcedAt;
        uint8 state;
    }

    struct NativeMintAttestation {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 destinationChainId;
        address destinationBridge;
        uint256 sourceWithdrawalId;
        address stratoToken;
        address representationToken;
        address recipient;
        uint256 amount;
        uint256 notBefore;
        uint256 deadline;
    }

    mapping(address => address) public stratoToRepresentation;
    mapping(address => address) public representationToStrato;
    mapping(address => bool) public routeActive;
    mapping(address => bool) public routeFrozen;
    mapping(bytes32 => bool) public processedMints;
    mapping(address => bool) public attestationSigners;

    uint96 public redemptionId;
    uint8 public attestationThreshold;
    uint8 public attestationSignerCount;
    uint256 public maxAttestationValiditySeconds;
    bool public mintsPaused;
    bool public redemptionsPaused;

    // ============ Fast-path state (appended; this is a live UUPS proxy) ============
    // New declarations MUST keep being appended here: an insertion anywhere
    // above silently re-points every mapping in the deployed proxy.

    /// @notice Half-life, in seconds, of the solver fee offered on a
    ///         redemption. Committed into each redemption log, so changing it
    ///         never re-prices a redemption already in flight.
    uint64 public redemptionFeeHalfLifeSeconds;

    /// @notice Ceiling on any offered fee, in basis points of the amount. The
    ///         anti-grief bound on claims; zero refuses every fee and so
    ///         disables the fast path outright.
    uint16 public maxFeeBps;

    /// @notice Master switch for {fillWithdrawal}.
    bool public fillsEnabled;

    /// @notice Master switch for {announceWithdrawal}.
    bool public announcementsEnabled;

    /// @notice Announcement bond configuration: the token and amount posted,
    ///         where a slashed bond goes, and how long before an unconfirmed
    ///         bond can be reclaimed.
    address public announcementBondToken;
    uint256 public announcementBondAmount;
    address public announcementSlashRecipient;
    uint64 public announcementTtlSeconds;

    /// @notice The head of each withdrawal's claim ladder.
    mapping(bytes32 => WithdrawalClaim) public withdrawalClaims;

    /// @notice Announced STRATO withdrawals, keyed by withdrawal key.
    mapping(bytes32 => Announcement) public announcements;

    /// @notice Announcement bonds this contract is holding, per token. Tracked
    ///         separately from the balance so that a bond is never mistaken
    ///         for a stray transfer.
    mapping(address => uint256) public bondedBalance;

    event RepresentationMinted(
        uint256 sourceChainId,
        address indexed sourceBridge,
        uint256 indexed sourceWithdrawalId,
        address indexed stratoToken,
        address representationToken,
        address recipient,
        uint256 amount,
        bytes32 mintId
    );
    event RedemptionRequested(
        address indexed representationToken,
        uint256 amount,
        address indexed sender,
        address indexed stratoRecipient,
        uint96 redemptionId
    );
    event TokenMappingRegistered(
        address indexed stratoToken,
        address indexed representationToken,
        bool frozen
    );
    event TokenMappingDisabled(
        address indexed stratoToken,
        address indexed representationToken
    );
    event TokenMappingEnabled(
        address indexed stratoToken,
        address indexed representationToken
    );
    event TokenMappingFrozen(
        address indexed stratoToken,
        address indexed representationToken
    );
    event TokenMappingMigrated(
        address indexed stratoToken,
        address indexed previousRepresentationToken,
        address indexed newRepresentationToken,
        bool frozen
    );
    event MintPauseUpdated(bool paused);
    event RedemptionPauseUpdated(bool paused);
    event AttestationSignerUpdated(address indexed signer, bool enabled);
    event AttestationThresholdUpdated(uint8 threshold);
    event MaxAttestationValidityUpdated(uint256 previousValiditySeconds, uint256 newValiditySeconds);

    // ============ Fast-path events ============
    /// @notice A redemption that offers a solver fee on the STRATO side.
    ///         Separate from {RedemptionRequested} rather than an extra field
    ///         on it: the relayer filters by topic0, and widening the old event
    ///         would have orphaned every deployed consumer at once.
    event RedemptionRequestedWithFee(
        address indexed representationToken,
        uint256 amount,
        address indexed sender,
        address indexed stratoRecipient,
        uint96 redemptionId,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    );
    /// @notice A solver took over a withdrawal's claim. `paidTo` is the party
    ///         they displaced: the recipient on claim 0, the previous claimant
    ///         after that.
    event WithdrawalFilled(
        bytes32 indexed withdrawalKey,
        address indexed filler,
        address indexed paidTo,
        uint32 claimIndex,
        address representationToken,
        uint256 amount,
        uint256 feeCharged,
        uint256 netPaid
    );
    /// @notice The mint was redirected to a claimant who had already paid the
    ///         recipient.
    event WithdrawalClaimSettled(
        bytes32 indexed withdrawalKey,
        address indexed claimant,
        uint32 claimIndex,
        uint256 feeCharged
    );
    /// @notice A claim existed but was made against different terms than the
    ///         attestation, so it was ignored and the recipient was minted to.
    ///         Emitted rather than reverted: a bad claim must never be able to
    ///         hold a real withdrawal hostage.
    event WithdrawalClaimVoided(
        bytes32 indexed withdrawalKey,
        address indexed claimant,
        bytes32 claimTermsHash,
        bytes32 attestedTermsHash
    );
    event WithdrawalAnnounced(
        bytes32 indexed withdrawalKey,
        address indexed announcer,
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId,
        address stratoToken,
        address representationToken,
        address recipient,
        uint256 amount,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife,
        address bondToken,
        uint256 bondAmount
    );
    /// @notice A claim holder changed whether, and at what price, they are
    ///         willing to be displaced.
    event WithdrawalClaimOfferUpdated(
        bytes32 indexed withdrawalKey,
        address indexed claimant,
        bool transferable,
        uint256 exitFee
    );
    event AnnouncementBondReturned(bytes32 indexed withdrawalKey, address indexed announcer, uint256 amount);
    event AnnouncementBondSlashed(bytes32 indexed withdrawalKey, address indexed announcer, uint256 amount, address recipient);
    event FeeConfigUpdated(uint64 redemptionFeeHalfLifeSeconds, uint16 maxFeeBps, bool fillsEnabled);
    event AnnouncementConfigUpdated(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    );

    error InvalidAddress();
    error ZeroAmount();
    error InvalidAttestation();
    error InvalidAttestationThreshold();
    error AttestationNotReady();
    error AttestationExpired();
    error BadAttestationSignatures();
    error TokenNotMapped();
    error RouteDisabled();
    error RouteFrozen();
    error ExistingTokenMapping();
    error RepresentationAlreadyMapped();
    error DuplicateMint();
    error MintsPaused();
    error RedemptionsPaused();
    error RouteHasSupply();
    error FeeTooLarge();
    error BadHalfLife();
    error FillsDisabled();
    error AnnouncementsDisabled();
    error AlreadyAnnounced();
    error BondAlreadyResolved();
    error BondNotReclaimable();
    error BondNotConfigured();
    error TermsMismatch();
    error FeeBelowMinimum();
    error ClaimExists();
    error NotTransferable();
    error AlreadyClaimant();
    error ShortDelivery();

    modifier whenMintsNotPaused() {
        if (mintsPaused) revert MintsPaused();
        _;
    }

    modifier whenRedemptionsNotPaused() {
        if (redemptionsPaused) revert RedemptionsPaused();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __EIP712_init("StratoNativeRepresentationBridge", "1");
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(MAPPING_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UNPAUSER_ROLE, admin);
        _grantRole(ATTESTATION_ADMIN_ROLE, admin);
        maxAttestationValiditySeconds = 7 days;
    }

    /**
     * @notice The original mint. Unchanged for an unclaimed withdrawal, and it
     *         now REFUSES a claimed one.
     *
     * @dev A V1 attestation carries no fee schedule, so there is nothing here
     *      to check a claim against. Minting to the recipient anyway would pay
     *      them twice -- once by the solver, once by this mint -- and strand
     *      the solver, so a claimed withdrawal has to go through
     *      {mintRepresentationWithAttestationV2} instead. That is the only
     *      behavioural change to this function.
     */
    function mintRepresentationWithAttestation(
        NativeMintAttestation calldata attestation,
        bytes[] calldata signatures
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused whenMintsNotPaused nonReentrant {
        _verifyAttestationSignatures(attestationDigest(attestation), signatures);

        NativeMintAttestationV2 memory widened;
        widened.sourceChainId = attestation.sourceChainId;
        widened.sourceBridge = attestation.sourceBridge;
        widened.destinationChainId = attestation.destinationChainId;
        widened.destinationBridge = attestation.destinationBridge;
        widened.sourceWithdrawalId = attestation.sourceWithdrawalId;
        widened.stratoToken = attestation.stratoToken;
        widened.representationToken = attestation.representationToken;
        widened.recipient = attestation.recipient;
        widened.amount = attestation.amount;
        widened.notBefore = attestation.notBefore;
        widened.deadline = attestation.deadline;

        _settleMint(widened, false);
    }

    /**
     * @notice Mint a withdrawal's representation tokens, to whoever holds the
     *         claim on it, or to the recipient if nobody does.
     *
     *         Identical to {mintRepresentationWithAttestation} in everything
     *         that governs whether the mint may happen at all -- same signer
     *         threshold, same notBefore, same deadline, same route checks,
     *         same one-mint-per-withdrawal dedup, and literally the same code
     *         for all of it -- and different only in where the tokens land.
     *         The attestation still names the original recipient; the signers
     *         never see a fill and are never asked to bless one.
     *
     *         A CLAIM IS PAID ONLY IF IT PRICED ITSELF AGAINST THESE TERMS.
     *         The claim's `termsHash` is recomputed from the attestation's own
     *         (amount, recipient, token, fee schedule); anything else is a
     *         solver who guessed wrong, and the recipient is minted to as if no
     *         claim existed. That is why an unverified claim cannot steal a
     *         mint, and why voiding is an event rather than a revert -- a bogus
     *         claim must not be able to strand a real withdrawal.
     *
     * @dev A voided claim leaves the solver's payment as a gift to the
     *      recipient. Supply is still exact: the solver moved tokens that
     *      already existed, and this mints exactly what STRATO locked.
     */
    function mintRepresentationWithAttestationV2(
        NativeMintAttestationV2 calldata attestation,
        bytes[] calldata signatures
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused whenMintsNotPaused nonReentrant {
        _verifyAttestationSignatures(attestationDigestV2(attestation), signatures);
        _settleMint(attestation, true);
    }

    /**
     * @dev The one validate-dedup-mint body both attestation versions run.
     *      Written once on purpose: the two shapes differ only in whether they
     *      carry a fee schedule, and letting them have separate mint bodies is
     *      how a route check ends up enforced on one path and not the other.
     *
     * @param honourClaims True for V2, whose attested schedule is what makes a
     *                     claim checkable. False for V1, which therefore
     *                     refuses a claimed withdrawal rather than paying the
     *                     recipient twice.
     */
    function _settleMint(NativeMintAttestationV2 memory attestation, bool honourClaims) internal {
        bytes32 mintId = _validateMintAttestation(attestation, honourClaims);

        if (processedMints[mintId]) revert DuplicateMint();
        processedMints[mintId] = true;

        address payee = attestation.recipient;
        WithdrawalClaim storage claim = withdrawalClaims[mintId];

        if (claim.claimant != address(0)) {
            if (!honourClaims) revert ClaimExists();

            bytes32 attestedTermsHash = _termsHash(
                attestation.sourceChainId,
                attestation.sourceBridge,
                attestation.sourceWithdrawalId,
                attestation.stratoToken,
                attestation.representationToken,
                attestation.recipient,
                attestation.amount,
                attestation.maxFee,
                attestation.requestedAt,
                attestation.feeHalfLife
            );

            if (claim.termsHash == attestedTermsHash) {
                payee = claim.claimant;
                emit WithdrawalClaimSettled(mintId, claim.claimant, claim.claimIndex, claim.feeCharged);
            } else {
                emit WithdrawalClaimVoided(mintId, claim.claimant, claim.termsHash, attestedTermsHash);
            }
        }

        StratoNativeRepresentationToken(attestation.representationToken).mint(
            payee,
            attestation.amount
        );

        emit RepresentationMinted(
            attestation.sourceChainId,
            attestation.sourceBridge,
            attestation.sourceWithdrawalId,
            attestation.stratoToken,
            attestation.representationToken,
            payee,
            attestation.amount,
            mintId
        );
    }

    /**
     * @dev Every gate a mint must pass, for either attestation version. The
     *      fee-schedule bounds only apply to a version that carries one: a
     *      schedule the origin contract could never have committed is refused
     *      here too, so a signer cannot attest terms no user ever agreed to.
     *
     * @dev The returned `mintId` is DELIBERATELY the withdrawal's claim key:
     *      both are keccak(sourceChainId, sourceBridge, sourceWithdrawalId), so
     *      "already minted" and "the claim on this withdrawal" are the same
     *      lookup and can never disagree.
     */
    function _validateMintAttestation(
        NativeMintAttestationV2 memory attestation,
        bool hasFeeSchedule
    ) internal view returns (bytes32 mintId) {
        if (attestation.sourceChainId == 0) revert InvalidAttestation();
        if (attestation.sourceBridge == address(0)) revert InvalidAttestation();
        if (attestation.sourceWithdrawalId == 0) revert InvalidAttestation();
        if (attestation.destinationChainId != block.chainid) revert InvalidAttestation();
        if (attestation.destinationBridge != address(this)) revert InvalidAttestation();
        if (attestation.recipient == address(0)) revert InvalidAddress();
        if (attestation.amount == 0) revert ZeroAmount();
        if (attestation.notBefore > block.timestamp) revert AttestationNotReady();
        if (attestation.deadline < block.timestamp) revert AttestationExpired();
        if (attestation.deadline < attestation.notBefore) revert InvalidAttestation();
        if (attestation.deadline > attestation.notBefore + maxAttestationValiditySeconds) {
            revert InvalidAttestation();
        }
        if (hasFeeSchedule) {
            if (attestation.maxFee >= attestation.amount) revert FeeTooLarge();
            if (
                attestation.maxFee > 0
                    && !BridgeFeeDecay.isHalfLifeAllowed(attestation.feeHalfLife)
            ) {
                revert BadHalfLife();
            }
        }

        address representationToken = stratoToRepresentation[attestation.stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        if (representationToken != attestation.representationToken) revert InvalidAttestation();
        if (!routeActive[attestation.stratoToken]) revert RouteDisabled();

        mintId = _withdrawalKeyOf(
            attestation.sourceChainId,
            attestation.sourceBridge,
            attestation.sourceWithdrawalId
        );
    }

    function attestationDigest(
        NativeMintAttestation calldata attestation
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    NATIVE_MINT_ATTESTATION_TYPEHASH,
                    attestation.sourceChainId,
                    attestation.sourceBridge,
                    attestation.destinationChainId,
                    attestation.destinationBridge,
                    attestation.sourceWithdrawalId,
                    attestation.stratoToken,
                    attestation.representationToken,
                    attestation.recipient,
                    attestation.amount,
                    attestation.notBefore,
                    attestation.deadline
                )
            )
        );
    }

    function _validateMintAttestation(
        NativeMintAttestation calldata attestation
    ) internal view returns (bytes32 mintId) {
        if (attestation.sourceChainId == 0) revert InvalidAttestation();
        if (attestation.sourceBridge == address(0)) revert InvalidAttestation();
        if (attestation.sourceWithdrawalId == 0) revert InvalidAttestation();
        if (attestation.destinationChainId != block.chainid) revert InvalidAttestation();
        if (attestation.destinationBridge != address(this)) revert InvalidAttestation();
        if (attestation.recipient == address(0)) revert InvalidAddress();
        if (attestation.amount == 0) revert ZeroAmount();
        if (attestation.notBefore > block.timestamp) revert AttestationNotReady();
        if (attestation.deadline < block.timestamp) revert AttestationExpired();
        if (attestation.deadline < attestation.notBefore) revert InvalidAttestation();
        if (attestation.deadline > attestation.notBefore + maxAttestationValiditySeconds) {
            revert InvalidAttestation();
        }

        address representationToken = stratoToRepresentation[attestation.stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        if (representationToken != attestation.representationToken) revert InvalidAttestation();
        if (!routeActive[attestation.stratoToken]) revert RouteDisabled();

        mintId = keccak256(
            abi.encode(
                attestation.sourceChainId,
                attestation.sourceBridge,
                attestation.sourceWithdrawalId
            )
        );
    }

    function _verifyAttestationSignatures(
        bytes32 digest,
        bytes[] calldata signatures
    ) internal view {
        uint8 threshold = attestationThreshold;
        if (threshold == 0 || signatures.length < threshold) {
            revert InvalidAttestationThreshold();
        }

        address previousSigner = address(0);
        uint8 validSignatures = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);
            if (!attestationSigners[signer] || signer <= previousSigner) {
                revert BadAttestationSignatures();
            }
            previousSigner = signer;
            unchecked {
                ++validSignatures;
            }
        }

        if (validSignatures < threshold) revert BadAttestationSignatures();
    }

    function requestRedemption(
        address representationToken,
        uint256 amount,
        address stratoRecipient
    ) external whenNotPaused whenRedemptionsNotPaused nonReentrant {
        uint96 id = _burnForRedemption(representationToken, amount, stratoRecipient);

        emit RedemptionRequested(
            representationToken,
            amount,
            msg.sender,
            stratoRecipient,
            id
        );
    }

    /**
     * @notice {requestRedemption}, plus a `maxFee` the user will pay a solver
     *         who delivers the STRATO-side funds before the relayer and review
     *         cycle has finished.
     *
     * @dev The fee is committed here and in the log, with the request
     *      timestamp and the half-life of its decay, so STRATO can compute
     *      exactly what the recipient is owed without trusting anyone's word
     *      for the terms. An uncommitted fee would let a solver pay a penny
     *      and claim the whole unlock.
     *
     * @param maxFee The ceiling, in this token's units, on what a solver may
     *               keep. Zero opts out of the fast path.
     */
    function requestRedemptionWithFee(
        address representationToken,
        uint256 amount,
        address stratoRecipient,
        uint256 maxFee
    ) external whenNotPaused whenRedemptionsNotPaused nonReentrant {
        uint256 halfLife = 0;
        if (maxFee > 0) {
            if (!BridgeFeeDecay.isFeeCapAllowed(maxFee, amount, maxFeeBps)) revert FeeTooLarge();
            halfLife = redemptionFeeHalfLifeSeconds;
            if (!BridgeFeeDecay.isHalfLifeAllowed(halfLife)) revert BadHalfLife();
        }

        uint96 id = _burnForRedemption(representationToken, amount, stratoRecipient);

        emit RedemptionRequestedWithFee(
            representationToken,
            amount,
            msg.sender,
            stratoRecipient,
            id,
            maxFee,
            block.timestamp,
            halfLife
        );
    }

    /// @dev The burn both redemption variants share. Unchanged behaviour:
    ///      tokens come here first and only this contract's own balance is
    ///      burned, so a redemption can never burn someone else's holding.
    function _burnForRedemption(
        address representationToken,
        uint256 amount,
        address stratoRecipient
    ) internal returns (uint96 id) {
        if (representationToken == address(0)) revert InvalidAddress();
        if (stratoRecipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        address stratoToken = representationToStrato[representationToken];
        if (stratoToken == address(0)) revert TokenNotMapped();
        if (!routeActive[stratoToken]) revert RouteDisabled();

        IERC20(representationToken).safeTransferFrom(msg.sender, address(this), amount);
        StratoNativeRepresentationToken(representationToken).burn(amount);

        unchecked {
            ++redemptionId;
        }
        return redemptionId;
    }

    function attestationDigestV2(
        NativeMintAttestationV2 calldata attestation
    ) public view returns (bytes32) {
        // Encoded in two halves and concatenated. Every field is a value
        // type, so abi.encode is plain 32-byte-word concatenation and the
        // result is byte-identical to encoding all fifteen at once -- which
        // does not fit in one stack frame.
        return _hashTypedDataV4(
            keccak256(
                bytes.concat(
                    abi.encode(
                        NATIVE_MINT_ATTESTATION_V2_TYPEHASH,
                        attestation.sourceChainId,
                        attestation.sourceBridge,
                        attestation.destinationChainId,
                        attestation.destinationBridge,
                        attestation.sourceWithdrawalId,
                        attestation.stratoToken,
                        attestation.representationToken
                    ),
                    abi.encode(
                        attestation.recipient,
                        attestation.amount,
                        attestation.notBefore,
                        attestation.deadline,
                        attestation.maxFee,
                        attestation.requestedAt,
                        attestation.feeHalfLife
                    )
                )
            )
        );
    }

    // ============ Fast path: claiming STRATO withdrawals here ============

    /// @notice The identity of a STRATO withdrawal on this chain: its source
    ///         bridge and id, never a block or log position.
    function withdrawalKeyFor(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId
    ) public pure returns (bytes32) {
        return _withdrawalKeyOf(sourceChainId, sourceBridge, withdrawalId);
    }

    /// @dev DELIBERATELY THE SAME PREIMAGE AS `mintId`. A withdrawal's claim
    ///      key and its mint-dedup key are the same three fields, so
    ///      `processedMints[withdrawalKey]` is exactly "this withdrawal has
    ///      already been minted" and the two never need to be reconciled.
    ///      Changing either preimage without the other would silently decouple
    ///      claims from mints.
    function _withdrawalKeyOf(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(sourceChainId, sourceBridge, withdrawalId));
    }

    /// @notice The binding between a claim and an attestation. Includes this
    ///         chain's id, so terms meant for one chain cannot be replayed on
    ///         another running the same bridge.
    function withdrawalTermsHash(WithdrawalTerms calldata terms) public view returns (bytes32) {
        return _termsHash(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId,
            terms.stratoToken,
            terms.representationToken,
            terms.recipient,
            terms.amount,
            terms.maxFee,
            terms.requestedAt,
            terms.feeHalfLife
        );
    }

    function _termsHash(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 withdrawalId,
        address stratoToken,
        address representationToken,
        address recipient,
        uint256 amount,
        uint256 maxFee,
        uint256 requestedAt,
        uint256 feeHalfLife
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                sourceChainId,
                sourceBridge,
                withdrawalId,
                stratoToken,
                representationToken,
                recipient,
                amount,
                maxFee,
                requestedAt,
                feeHalfLife
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
        bytes32 key = _withdrawalKeyOf(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        WithdrawalClaim storage c = withdrawalClaims[key];
        if (c.claimant == address(0)) {
            payTo = terms.recipient;
            feeCharged = BridgeFeeDecay.decayedFee(
                terms.maxFee,
                terms.requestedAt,
                terms.feeHalfLife,
                block.timestamp
            );
            forSale = true;
        } else {
            payTo = c.claimant;
            feeCharged = c.exitFee;
            forSale = c.transferable;
        }
        netToPay = terms.amount - feeCharged;
    }

    /**
     * @notice Hand a STRATO withdrawal's recipient their representation tokens
     *         out of your own holdings, ahead of the attestation and the Safe,
     *         and take over the claim on the eventual mint.
     *
     *         The transfer runs HERE, solver to payee, so "the payee was paid"
     *         becomes a fact in this chain's ledger rather than a promise. What
     *         the solver keeps is the decayed fee: they must deliver
     *         `amount - decayedFee(...)` computed from the committed schedule
     *         and this block's timestamp.
     *
     *         THE CLAIM IS A LADDER. On the first claim the payee is the
     *         recipient; on every claim after that it is the PREVIOUS
     *         CLAIMANT, paid `amount - fee(now)` in turn -- so a solver who
     *         claimed at the full fee can hand the position to one who will
     *         take a thinner one, and keeps the decay accrued while they held
     *         it. The recipient is paid once, the mint happens once, and the
     *         difference is split by who held the claim when.
     *
     * @dev NOTHING HERE VERIFIES THE WITHDRAWAL EXISTS, deliberately -- this
     *      chain cannot know until the attestation arrives. A claim against a
     *      withdrawal that was never requested, or against terms the signers
     *      do not attest, pays a stranger and earns nothing. That is the risk
     *      the fee prices, and the reason a solver should read STRATO rather
     *      than trust an announcement here.
     *
     * @dev The route must be mapped and active. A claim on a disabled route
     *      could never be minted, so accepting one would only ever cost the
     *      solver.
     */
    function fillWithdrawal(
        WithdrawalTerms calldata terms,
        uint256 expectedFee,
        bool transferable,
        uint256 exitFee
    )
        external
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

        _deliver(terms.representationToken, outcome.payTo, outcome.netPaid);

        emit WithdrawalFilled(
            withdrawalKey,
            msg.sender,
            outcome.payTo,
            outcome.nextIndex,
            terms.representationToken,
            terms.amount,
            outcome.feeCharged,
            outcome.netPaid
        );
    }

    /**
     * @dev Move a solver's tokens to the party they are displacing, VIA THIS
     *      CONTRACT rather than directly.
     *
     *      THE TOKEN MAY FORBID THE DIRECT TRANSFER. A representation token
     *      starts with `transfersEnabled` false, in which case
     *      StratoNativeRepresentationToken only permits a transfer where one
     *      side is a registered endpoint -- and this bridge is one, while a
     *      solver and a recipient are not. Hopping through here satisfies that
     *      policy on both legs instead of asking for it to be relaxed, so a
     *      route can run the fast path while still being locked down. The two
     *      legs are one transaction, so nothing rests here and no balance
     *      survives the call.
     *
     *      Both legs are measured, not assumed: a representation token is
     *      upgradeable, and a solver must not be credited with a full claim
     *      for a partial delivery.
     */
    function _deliver(address representationToken, address payTo, uint256 amount) internal {
        IERC20 token = IERC20(representationToken);

        uint256 selfBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - selfBefore != amount) revert ShortDelivery();

        uint256 payeeBefore = token.balanceOf(payTo);
        token.safeTransfer(payTo, amount);
        if (token.balanceOf(payTo) - payeeBefore != amount) revert ShortDelivery();
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
        if (terms.recipient == address(0) || terms.sourceBridge == address(0)) {
            revert InvalidAddress();
        }
        if (terms.sourceChainId == 0 || terms.withdrawalId == 0) revert InvalidAddress();
        if (terms.amount == 0) revert ZeroAmount();
        if (terms.representationToken == address(0)) revert TokenNotMapped();
        if (stratoToRepresentation[terms.stratoToken] != terms.representationToken) {
            revert TokenNotMapped();
        }
        // A claim on a disabled route could never be minted, so accepting one
        // would only ever cost the solver.
        if (!routeActive[terms.stratoToken]) revert RouteDisabled();
        if (!BridgeFeeDecay.isFeeCapAllowed(terms.maxFee, terms.amount, maxFeeBps)) {
            revert FeeTooLarge();
        }
        if (terms.maxFee > 0 && !BridgeFeeDecay.isHalfLifeAllowed(terms.feeHalfLife)) {
            revert BadHalfLife();
        }
        if (exitFee >= terms.amount) revert FeeTooLarge();

        withdrawalKey = _withdrawalKeyOf(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        // Already minted: there is nothing left to claim, only a recipient who
        // has been paid.
        if (processedMints[withdrawalKey]) revert DuplicateMint();
    }

    /// @dev Move the ladder up one rung and record the new head. Returns who
    ///      must be paid and how much; the transfer happens in the caller,
    ///      AFTER this has written the new head, because the payee may be a
    ///      contract.
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
            // withdrawal is good must be able to keep their position.
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
     *         Callable by the current holder at any time before the mint, as
     *         often as they like. A solver's read on a withdrawal changes, and
     *         the position they are holding should be repriceable when it
     *         does. Setting `transferable` false takes it off the market.
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
        bytes32 withdrawalKey = _withdrawalKeyOf(
            terms.sourceChainId,
            terms.sourceBridge,
            terms.withdrawalId
        );
        if (processedMints[withdrawalKey]) revert DuplicateMint();
        if (exitFee >= terms.amount) revert FeeTooLarge();

        WithdrawalClaim storage claim = withdrawalClaims[withdrawalKey];
        if (claim.claimant != msg.sender) revert InvalidAddress();
        if (claim.termsHash != withdrawalTermsHash(terms)) revert TermsMismatch();

        claim.transferable = transferable;
        claim.exitFee = transferable ? exitFee : 0;

        emit WithdrawalClaimOfferUpdated(withdrawalKey, msg.sender, transferable, claim.exitFee);
    }

    // ============ Fast path: permissionless announcements ============

    /**
     * @notice Post a STRATO withdrawal here before the relayer has confirmed
     *         it, so a solver can claim it immediately.
     *
     *         An announcement mints nothing and proves nothing. It is a
     *         coordination surface: the relayer stops being the starting gun
     *         and becomes a confirmation bot. Anyone may post one, which is why
     *         it costs a bond -- refunded when the relayer confirms it,
     *         reclaimable if the relayer never does, and slashed only when
     *         governance rules it fake.
     *
     * @dev A SOLVER MUST NOT TREAT THIS AS EVIDENCE. Announcements are
     *      unverified by construction; a solver who claims against one without
     *      reading STRATO is trusting a stranger, and that loss is theirs.
     */
    function announceWithdrawal(WithdrawalTerms calldata terms)
        external
        nonReentrant
        returns (bytes32 withdrawalKey)
    {
        if (!announcementsEnabled) revert AnnouncementsDisabled();
        if (terms.recipient == address(0) || terms.sourceBridge == address(0)) {
            revert InvalidAddress();
        }
        if (terms.sourceChainId == 0 || terms.withdrawalId == 0) revert InvalidAddress();
        if (terms.amount == 0) revert ZeroAmount();
        if (stratoToRepresentation[terms.stratoToken] != terms.representationToken) {
            revert TokenNotMapped();
        }

        withdrawalKey = _withdrawalKeyOf(
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
            terms.stratoToken,
            terms.representationToken,
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
    function confirmAnnouncement(bytes32 withdrawalKey)
        external
        onlyRole(ATTESTATION_ADMIN_ROLE)
        nonReentrant
    {
        _returnBond(withdrawalKey);
    }

    /// @notice Reclaim your own bond once the relayer has had long enough to
    ///         confirm and has not. Permissionless: an announcer should never
    ///         need an admin to get their own money back, and a relayer outage
    ///         must not read as fraud.
    function reclaimAnnouncementBond(bytes32 withdrawalKey) external nonReentrant {
        Announcement storage a = announcements[withdrawalKey];
        if (a.state != 1) revert BondAlreadyResolved();
        if (block.timestamp < uint256(a.announcedAt) + announcementTtlSeconds) {
            revert BondNotReclaimable();
        }
        _returnBond(withdrawalKey);
    }

    /// @notice Slash a fake announcement's bond. The only path that takes
    ///         someone's bond, and governance-gated for that reason: an
    ///         announcement that merely disagrees with the relayer's numbers is
    ///         superseded, not fraudulent, and its bond is reclaimable.
    function rejectAnnouncement(bytes32 withdrawalKey)
        external
        onlyRole(ATTESTATION_ADMIN_ROLE)
        nonReentrant
    {
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

    /// @notice Return a stray balance. Announcement bonds are NOT stray: only
    ///         the excess over {bondedBalance} can leave, so an announcer's
    ///         bond cannot be swept out from under them.
    function sweepUnbonded(address token, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 bonded = bondedBalance[token];
        if (bal <= bonded) return;
        IERC20(token).safeTransfer(to, bal - bonded);
    }

    // ============ Fast-path configuration ============

    /**
     * @notice Turn the fast path on and set its shape. The reinitializer makes
     *         it one-shot; {initialize} has already run on the deployed proxy.
     *
     * @dev Version 3, not 2. This proxy has ALREADY been reinitialized once --
     *      the v1.1.0 upgrade (which added the since-removed mint-executor role) left the live
     *      Sepolia proxy at `_initialized == 2` -- so `reinitializer(2)` can
     *      never pass here and reverts with InvalidInitialization(). The
     *      version counts initializations of the PROXY, not releases of the
     *      contract, and the only place that count is visible is the live
     *      chain: a fresh local deployment sits at 1 and makes either value
     *      look correct. Its sibling DepositRouter is still at 1 and so keeps
     *      version 2. Check the storage slot before adding version 4.
     */
    function initializeFastPath(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    ) external reinitializer(3) onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeConfig(halfLifeSeconds, feeBpsCeiling, true);
        _setAnnouncementConfig(true, bondToken, bondAmount, slashRecipient, ttlSeconds);
    }

    function setFeeConfig(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        bool enableFills
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeConfig(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    function _setFeeConfig(
        uint64 halfLifeSeconds,
        uint16 feeBpsCeiling,
        bool enableFills
    ) internal {
        if (!BridgeFeeDecay.isHalfLifeAllowed(halfLifeSeconds)) revert BadHalfLife();
        if (feeBpsCeiling > BridgeFeeDecay.BPS_DENOMINATOR) revert FeeTooLarge();
        redemptionFeeHalfLifeSeconds = halfLifeSeconds;
        maxFeeBps = feeBpsCeiling;
        fillsEnabled = enableFills;
        emit FeeConfigUpdated(halfLifeSeconds, feeBpsCeiling, enableFills);
    }

    function setAnnouncementConfig(
        bool enabled,
        address bondToken,
        uint256 bondAmount,
        address slashRecipient,
        uint64 ttlSeconds
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    function registerTokenMapping(
        address stratoToken,
        address representationToken,
        bool freezeRoute
    ) public onlyRole(MAPPING_ADMIN_ROLE) {
        if (stratoToken == address(0) || representationToken == address(0)) revert InvalidAddress();
        if (stratoToRepresentation[stratoToken] != address(0)) revert ExistingTokenMapping();
        if (representationToStrato[representationToken] != address(0)) revert RepresentationAlreadyMapped();

        stratoToRepresentation[stratoToken] = representationToken;
        representationToStrato[representationToken] = stratoToken;
        routeActive[stratoToken] = true;
        routeFrozen[stratoToken] = freezeRoute;

        emit TokenMappingRegistered(stratoToken, representationToken, freezeRoute);
    }

    function setTokenMapping(
        address stratoToken,
        address representationToken
    ) external onlyRole(MAPPING_ADMIN_ROLE) {
        registerTokenMapping(stratoToken, representationToken, false);
    }

    function disableTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeActive[stratoToken] = false;
        emit TokenMappingDisabled(stratoToken, representationToken);
    }

    function enableTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeActive[stratoToken] = true;
        emit TokenMappingEnabled(stratoToken, representationToken);
    }

    function freezeTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeFrozen[stratoToken] = true;
        emit TokenMappingFrozen(stratoToken, representationToken);
    }

    function migrateTokenMapping(
        address stratoToken,
        address newRepresentationToken,
        bool freezeRoute
    ) external onlyRole(MAPPING_ADMIN_ROLE) whenPaused {
        address currentRepresentationToken = stratoToRepresentation[stratoToken];
        if (currentRepresentationToken == address(0)) revert TokenNotMapped();
        if (newRepresentationToken == address(0)) revert InvalidAddress();
        if (routeFrozen[stratoToken]) revert RouteFrozen();
        if (representationToStrato[newRepresentationToken] != address(0)) {
            revert RepresentationAlreadyMapped();
        }
        if (IERC20(currentRepresentationToken).totalSupply() != 0) revert RouteHasSupply();

        representationToStrato[currentRepresentationToken] = address(0);
        stratoToRepresentation[stratoToken] = newRepresentationToken;
        representationToStrato[newRepresentationToken] = stratoToken;
        routeActive[stratoToken] = true;
        routeFrozen[stratoToken] = freezeRoute;

        emit TokenMappingMigrated(
            stratoToken,
            currentRepresentationToken,
            newRepresentationToken,
            freezeRoute
        );
    }

    function setAttestationSigner(
        address signer,
        bool enabled
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidAddress();
        bool currentlyEnabled = attestationSigners[signer];
        if (currentlyEnabled == enabled) {
            return;
        }

        if (enabled) {
            unchecked {
                ++attestationSignerCount;
            }
        } else {
            uint8 newSignerCount = attestationSignerCount - 1;
            if (attestationThreshold > newSignerCount) revert InvalidAttestationThreshold();
            attestationSignerCount = newSignerCount;
        }

        attestationSigners[signer] = enabled;
        emit AttestationSignerUpdated(signer, enabled);
    }

    function setAttestationThreshold(
        uint8 threshold
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (threshold == 0 || threshold > attestationSignerCount) {
            revert InvalidAttestationThreshold();
        }

        attestationThreshold = threshold;
        emit AttestationThresholdUpdated(threshold);
    }

    function setMaxAttestationValiditySeconds(
        uint256 validitySeconds
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (validitySeconds == 0) revert InvalidAttestation();
        uint256 previousValiditySeconds = maxAttestationValiditySeconds;
        maxAttestationValiditySeconds = validitySeconds;
        emit MaxAttestationValidityUpdated(previousValiditySeconds, validitySeconds);
    }

    function setMintPaused(bool paused_) external {
        if (paused_) {
            _checkRole(PAUSER_ROLE);
        } else {
            _checkRole(UNPAUSER_ROLE);
        }
        mintsPaused = paused_;
        emit MintPauseUpdated(paused_);
    }

    function setRedemptionsPaused(bool paused_) external {
        if (paused_) {
            _checkRole(PAUSER_ROLE);
        } else {
            _checkRole(UNPAUSER_ROLE);
        }
        redemptionsPaused = paused_;
        emit RedemptionPauseUpdated(paused_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./RateLimitLib.sol";
import "./StratoRepresentationToken.sol";

/// @title StratoRepresentationBridge
/// @notice Controls mint/burn of StratoRepresentationTokens on an external chain.
///         One deployment per external chain. Holds MINTER_ROLE on each
///         representation token.
///
/// @dev Flow model:
///      - Outbound (STRATO -> external): bridge operator calls
///        `mintRepresentation` after STRATO-side tokens are locked in
///        StratoCustodyVault. Rate-limited.
///      - Inbound (external -> STRATO): a representation holder calls
///        `redeem` directly. The bridge pulls their tokens via `transferFrom`
///        into its own custody, burns its own balance, and emits
///        `RepresentationBurned` carrying the stratoRecipient. The STRATO-side
///        relayer observes the event, verifies the tx receipt, and calls
///        MercataBridge.deposit -> confirmDeposit, which routes to
///        StratoCustodyVault.unlock via the isNative branch.
///
///        Crucially, there is NO operator-initiated burn: the bridge can only
///        burn tokens it has actually received from a holder's allowance,
///        which preserves user authorization end-to-end.
contract StratoRepresentationBridge is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using RateLimitLib for RateLimitLib.RateLimit;
    using SafeERC20 for IERC20;

    // ============ Roles ============

    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR");

    // ============ State ============

    /// @notice Maps STRATO-side token address to its representation token on this chain.
    mapping(address => address) public stratoToRepresentation;

    /// @notice Per-token rate limits for minting (outbound from STRATO).
    mapping(address => RateLimitLib.RateLimit) public mintRateLimits;

    /// @notice Per-token rate limits for redemption/burn (inbound return to STRATO).
    mapping(address => RateLimitLib.RateLimit) public burnRateLimits;

    // ============ Events ============

    event RepresentationMinted(
        address indexed stratoToken,
        address indexed representationToken,
        address indexed recipient,
        uint256 amount
    );

    /// @notice Emitted when a holder redeems representation tokens back to STRATO.
    /// @param stratoToken     STRATO-side token the representation corresponds to.
    /// @param from            External-chain holder whose tokens were burned.
    /// @param stratoRecipient STRATO-chain address to receive the unlocked asset.
    /// @param representationToken The ERC-20 that was burned.
    /// @param amount          Amount burned (in 18-decimal STRATO precision).
    event RepresentationBurned(
        address indexed stratoToken,
        address indexed from,
        address indexed stratoRecipient,
        address representationToken,
        uint256 amount
    );

    event TokenMappingUpdated(address indexed stratoToken, address indexed representationToken);
    event MintRateLimitUpdated(address indexed stratoToken, uint256 maxAmount, uint256 windowDuration);
    event BurnRateLimitUpdated(address indexed stratoToken, uint256 maxAmount, uint256 windowDuration);

    // ============ Errors ============

    error InvalidAddress();
    error ZeroAmount();
    error TokenNotMapped();
    error BurnAmountMismatch(uint256 expected, uint256 received);

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin The Safe multisig address that governs this bridge.
    function initialize(address admin) external initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ============ Operator Functions ============

    /// @notice Mint representation tokens on this chain (STRATO -> external outbound).
    ///         Called by the bridge operator after STRATO-native tokens are
    ///         locked in StratoCustodyVault.
    /// @param stratoToken The STRATO-side token address (used as the mapping key).
    /// @param recipient   The recipient on this external chain.
    /// @param amount      The amount to mint (in 18-decimal STRATO precision).
    function mintRepresentation(
        address stratoToken,
        address recipient,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        address repToken = stratoToRepresentation[stratoToken];
        if (repToken == address(0)) revert TokenNotMapped();

        mintRateLimits[stratoToken].consume(amount);

        StratoRepresentationToken(repToken).mint(recipient, amount);

        emit RepresentationMinted(stratoToken, repToken, recipient, amount);
    }

    // ============ Permissionless (user-initiated) Functions ============

    /// @notice Redeem representation tokens back to the STRATO chain.
    ///         The caller must have approved this bridge to spend at least
    ///         `amount` of the representation token. This contract pulls the
    ///         tokens via `transferFrom` and then burns its own balance, so
    ///         user authorization is preserved end-to-end.
    ///
    /// @param stratoToken     STRATO-side token to unlock on the STRATO chain.
    /// @param stratoRecipient STRATO-chain address that will receive the asset
    ///                        after the relayer observes this burn.
    /// @param amount          Amount to redeem (in 18-decimal STRATO precision).
    function redeem(
        address stratoToken,
        address stratoRecipient,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        if (stratoRecipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        address repToken = stratoToRepresentation[stratoToken];
        if (repToken == address(0)) revert TokenNotMapped();

        burnRateLimits[stratoToken].consume(amount);

        // Pull tokens into protocol custody. Fee-on-transfer tokens would make
        // `received < amount`; representation tokens we deploy are plain
        // ERC-20s, so we assert equality to keep accounting unambiguous.
        IERC20 token = IERC20(repToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert BurnAmountMismatch(amount, received);

        // Burn the bridge's own balance. StratoRepresentationToken.burn only
        // decrements msg.sender's balance, so this cannot affect anyone else.
        StratoRepresentationToken(repToken).burn(amount);

        emit RepresentationBurned(stratoToken, msg.sender, stratoRecipient, repToken, amount);
    }

    // ============ Admin Functions ============

    /// @notice Map a STRATO-side token address to its representation token on this chain.
    function setTokenMapping(
        address stratoToken,
        address representationToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (stratoToken == address(0) || representationToken == address(0)) revert InvalidAddress();
        stratoToRepresentation[stratoToken] = representationToken;
        emit TokenMappingUpdated(stratoToken, representationToken);
    }

    /// @notice Configure the mint rate limit for a STRATO token.
    function setMintRateLimit(
        address stratoToken,
        uint256 maxAmount,
        uint256 windowDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mintRateLimits[stratoToken].configure(maxAmount, windowDuration);
        emit MintRateLimitUpdated(stratoToken, maxAmount, windowDuration);
    }

    /// @notice Configure the burn rate limit for a STRATO token.
    function setBurnRateLimit(
        address stratoToken,
        uint256 maxAmount,
        uint256 windowDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        burnRateLimits[stratoToken].configure(maxAmount, windowDuration);
        emit BurnRateLimitUpdated(stratoToken, maxAmount, windowDuration);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ Views ============

    function remainingMintLimit(address stratoToken) external view returns (uint256) {
        return mintRateLimits[stratoToken].remaining();
    }

    function remainingBurnLimit(address stratoToken) external view returns (uint256) {
        return burnRateLimits[stratoToken].remaining();
    }

    function getRepresentationToken(address stratoToken) external view returns (address) {
        return stratoToRepresentation[stratoToken];
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}

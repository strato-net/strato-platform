// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./RateLimitLib.sol";
import "./StratoRepresentationToken.sol";

/// @title StratoRepresentationBridge
/// @notice Controls mint/burn of StratoRepresentationTokens on an external chain.
///         One deployment per external chain. Holds MINTER_ROLE on each representation token.
///         The bridge service operator calls mintRepresentation (STRATO -> external outbound)
///         and burnRepresentation (external -> STRATO inbound return).
contract StratoRepresentationBridge is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using RateLimitLib for RateLimitLib.RateLimit;

    // ============ Roles ============

    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR");

    // ============ State ============

    /// @notice Maps STRATO-side token address to its representation token on this chain.
    mapping(address => address) public stratoToRepresentation;

    /// @notice Per-token rate limits for minting (outbound from STRATO).
    mapping(address => RateLimitLib.RateLimit) public mintRateLimits;

    /// @notice Per-token rate limits for burning (inbound return to STRATO).
    mapping(address => RateLimitLib.RateLimit) public burnRateLimits;

    // ============ Events ============

    event RepresentationMinted(
        address indexed stratoToken,
        address indexed representationToken,
        address indexed recipient,
        uint256 amount
    );

    event RepresentationBurned(
        address indexed stratoToken,
        address indexed representationToken,
        address indexed from,
        uint256 amount
    );

    event TokenMappingUpdated(address indexed stratoToken, address indexed representationToken);
    event MintRateLimitUpdated(address indexed stratoToken, uint256 maxAmount, uint256 windowDuration);
    event BurnRateLimitUpdated(address indexed stratoToken, uint256 maxAmount, uint256 windowDuration);

    // ============ Errors ============

    error InvalidAddress();
    error ZeroAmount();
    error TokenNotMapped();

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
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ============ Operator Functions ============

    /// @notice Mint representation tokens on this chain (STRATO -> external outbound).
    ///         Called by the bridge operator after STRATO-native tokens are locked in StratoCustodyVault.
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

    /// @notice Burn representation tokens on this chain (external -> STRATO inbound return).
    ///         The user must have approved this bridge contract to spend their representation tokens.
    ///         Called by the bridge operator after the user initiates a return-to-STRATO flow.
    /// @param stratoToken The STRATO-side token address (used as the mapping key).
    /// @param from        The holder whose tokens are burned.
    /// @param amount      The amount to burn.
    function burnRepresentation(
        address stratoToken,
        address from,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused {
        if (from == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        address repToken = stratoToRepresentation[stratoToken];
        if (repToken == address(0)) revert TokenNotMapped();

        burnRateLimits[stratoToken].consume(amount);

        StratoRepresentationToken(repToken).burn(from, amount);

        emit RepresentationBurned(stratoToken, repToken, from, amount);
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
        return "1.0.0";
    }
}

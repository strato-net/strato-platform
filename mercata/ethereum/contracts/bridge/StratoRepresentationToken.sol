// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title StratoRepresentationToken
/// @notice ERC-20 representation of a STRATO-native asset on an external chain.
///         One deployment per asset (USDST, GOLDST, SILVST) per chain.
///
/// @dev Trust boundary:
///      - MINTER_ROLE can mint to any recipient (the bridge mints on outbound
///        flows) but can ONLY burn from its own balance. Burning arbitrary
///        holders' tokens is disallowed; to redeem, a user must transfer their
///        representation tokens into the bridge first (via the redemption flow
///        in StratoRepresentationBridge), and the bridge then burns its own
///        balance. This closes the operator-initiated-burn hole from earlier
///        revisions of the contract.
contract StratoRepresentationToken is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // ============ Roles ============

    bytes32 public constant MINTER_ROLE = keccak256("MINTER");

    // ============ Errors ============

    error InvalidAddress();
    error ZeroAmount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param name_   Token name (e.g., "USDST")
    /// @param symbol_ Token symbol (e.g., "USDST")
    /// @param admin   The Safe multisig address that governs this token.
    function initialize(
        string memory name_,
        string memory symbol_,
        address admin
    ) external initializer {
        if (admin == address(0)) revert InvalidAddress();

        __ERC20_init(name_, symbol_);
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ============ Minter Functions ============

    /// @notice Mint representation tokens to a recipient.
    ///         Called by StratoRepresentationBridge when the bridge service
    ///         has observed a corresponding STRATO-side lock.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Burn representation tokens from the caller's own balance.
    /// @dev Deliberately does NOT accept a `from` parameter. The previous
    ///      `burn(address from, uint256)` variant allowed a MINTER_ROLE holder
    ///      (the bridge) to destroy any user's balance. Redemptions now pull
    ///      tokens into the bridge via transferFrom first, then the bridge
    ///      burns its own balance with this function.
    function burn(uint256 amount) external onlyRole(MINTER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        _burn(msg.sender, amount);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}

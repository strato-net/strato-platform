// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title StratoRepresentationToken
/// @notice ERC-20 representation of a STRATO-native asset on an external chain.
///         One deployment per asset (USDST, GOLDST, SILVST) per chain.
///         Only the StratoRepresentationBridge (MINTER_ROLE) can mint and burn.
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
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Burn representation tokens from an account.
    ///         The caller (StratoRepresentationBridge) must hold MINTER_ROLE.
    ///         The `from` account must have approved the bridge to spend their tokens,
    ///         or the bridge calls this after receiving tokens via transferFrom.
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (from == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

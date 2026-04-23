// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title StratoNativeRepresentationToken
/// @notice ERC-20 representation of a STRATO-native asset on an external chain.
/// @notice Only the bridge contract may mint tokens and burn the balance it already holds.
contract StratoNativeRepresentationToken is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");

    error InvalidAddress();
    error ZeroAmount();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

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

    function mint(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }

    /// @notice Burn only the bridge contract's own balance after it has received user tokens.
    function burn(uint256 amount) external onlyRole(BRIDGE_ROLE) {
        if (amount == 0) revert ZeroAmount();
        _burn(_msgSender(), amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

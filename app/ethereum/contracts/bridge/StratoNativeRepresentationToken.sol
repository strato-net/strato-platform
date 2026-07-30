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
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant TRANSFER_ADMIN_ROLE = keccak256("TRANSFER_ADMIN_ROLE");

    bool public transfersEnabled;
    mapping(address => bool) public transferEndpoints;

    event TransfersEnabledUpdated(bool enabled);
    event TransferEndpointUpdated(address indexed account, bool allowed);

    error InvalidAddress();
    error ZeroAmount();
    error TransfersDisabled();

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
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(TRANSFER_ADMIN_ROLE, admin);
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

    function setTransfersEnabled(bool enabled) external onlyRole(TRANSFER_ADMIN_ROLE) {
        transfersEnabled = enabled;
        emit TransfersEnabledUpdated(enabled);
    }

    function setTransferEndpoint(address account, bool allowed) external onlyRole(TRANSFER_ADMIN_ROLE) {
        if (account == address(0)) revert InvalidAddress();
        transferEndpoints[account] = allowed;
        emit TransferEndpointUpdated(account, allowed);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (
            !transfersEnabled &&
            from != address(0) &&
            to != address(0) &&
            !transferEndpoints[from] &&
            !transferEndpoints[to]
        ) {
            revert TransfersDisabled();
        }
        super._update(from, to, value);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

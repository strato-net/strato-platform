// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./RateLimitLib.sol";

/// @title ExternalBridgeVault
/// @notice Holds canonical external assets (ETH, USDC, WBTC) on external chains.
///         Replaces Gnosis Safe as the direct custody wallet for standard bridge flows.
///         DepositRouter sends deposits here; the bridge operator releases funds for withdrawals.
contract ExternalBridgeVault is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using RateLimitLib for RateLimitLib.RateLimit;

    // ============ Roles ============

    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR");

    // ============ State ============

    /// @notice Per-token rate limit for operator-initiated releases.
    ///         address(0) is used as the key for native ETH.
    mapping(address => RateLimitLib.RateLimit) public rateLimits;

    // ============ Events ============

    event Released(address indexed token, address indexed recipient, uint256 amount);
    event ReleasedETH(address indexed recipient, uint256 amount);
    event RateLimitUpdated(address indexed token, uint256 maxAmount, uint256 windowDuration);
    event SweptERC20(address indexed token, address indexed to, uint256 amount);
    event SweptETH(address indexed to, uint256 amount);

    // ============ Errors ============

    error InvalidAddress();
    error ZeroAmount();
    error ETHTransferFailed();
    error InsufficientBalance();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin The Safe multisig address that governs this vault.
    function initialize(address admin) external initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ============ Operator Functions ============

    /// @notice Release ERC-20 tokens to a recipient. Rate-limited.
    function release(
        address token,
        address recipient,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused nonReentrant {
        if (token == address(0)) revert InvalidAddress();
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        rateLimits[token].consume(amount);

        IERC20(token).safeTransfer(recipient, amount);

        emit Released(token, recipient, amount);
    }

    /// @notice Release native ETH to a recipient. Rate-limited.
    function releaseETH(
        address payable recipient,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused nonReentrant {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientBalance();

        rateLimits[address(0)].consume(amount);

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert ETHTransferFailed();

        emit ReleasedETH(recipient, amount);
    }

    // ============ Admin Functions ============

    /// @notice Configure the rate limit for a token. Use address(0) for ETH.
    function setRateLimit(
        address token,
        uint256 maxAmount,
        uint256 windowDuration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rateLimits[token].configure(maxAmount, windowDuration);
        emit RateLimitUpdated(token, maxAmount, windowDuration);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Emergency sweep ERC-20 tokens back to a Safe-controlled address.
    function sweepERC20(
        address token,
        address to
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, balance);
        emit SweptERC20(token, to, balance);
    }

    /// @notice Emergency sweep ETH back to a Safe-controlled address.
    function sweepETH(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert InvalidAddress();
        uint256 balance = address(this).balance;
        if (balance == 0) revert ZeroAmount();
        (bool success, ) = to.call{value: balance}("");
        if (!success) revert ETHTransferFailed();
        emit SweptETH(to, balance);
    }

    // ============ Views ============

    /// @notice Remaining release capacity for a token in the current window.
    function remainingRateLimit(address token) external view returns (uint256) {
        return rateLimits[token].remaining();
    }

    // ============ Receive ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

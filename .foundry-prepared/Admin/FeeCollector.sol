// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../abstract/ERC20/IERC20.sol";
import "../abstract/ERC20/access/Ownable.sol";

/**
 * @title FeeCollector
 * @notice Minimal owner-controlled contract to collect and withdraw protocol ERC20 fees
 * @dev Only the owner can withdraw any ERC20 token held by this contract
 */
contract  FeeCollector is Ownable {
    /// @notice Emitted when tokens are withdrawn by the owner
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    /**
     * @param _owner The address that will control withdrawals
     */
    constructor(address _owner) Ownable(_owner) {}

    /**
     * @notice Withdraw ERC20 tokens to a recipient (owner only)
     * @param token Address of the ERC20 token
     * @param to Recipient address
     * @param amount Amount to withdraw
     * @dev Only callable by the contract owner
     */
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "FeeCollector: zero token address");
        require(to != address(0), "FeeCollector: zero recipient address");
        require(amount > 0, "FeeCollector: zero amount");
        require(IERC20(token).balanceOf(address(this)) >= amount, "FeeCollector: insufficient balance");
        require(IERC20(token).transfer(to, amount), "FeeCollector: transfer failed");
        emit Withdrawn(token, to, amount);
    }
} 
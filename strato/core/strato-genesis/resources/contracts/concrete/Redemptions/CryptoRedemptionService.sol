pragma solidity ^0.8.0;

import "./RedemptionService.sol";
import "./Bridge/MercataETHBridge.sol";

contract record CryptoRedemptionService is RedemptionService {
    MercataEthBridge public bridge;

    constructor(
        address _token,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount,
        address _bridge
    ) RedemptionService(
        _token,
        _pool,
        _initialSpotPrice,
        _maxRedemptionAmount
    ) {
        bridge = MercataEthBridge(_bridge);
    }

    /**
     * @notice Redeem tokens for underlying crypto assets at the spot price
     * @param tokenAmount Amount of tokens to redeem
     * @param baseAddress The address to receive the native tokens
     */
    function redeemAtSpot(uint256 tokenAmount, string baseAddress) external override {
        require(isActive, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        // Transfer tokens from user to contract
        require(ERC20(token).transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");

        // Use bridge to burn and initiate withdrawal NEEDS TO BE IMPLEMENTED
        // bridge.burnETHST(tokens, tokenAmount, baseAddress); NEEDS TO BE IMPLEMENTED
        emit Redeemed(msg.sender, tokenAmount);
    }
}
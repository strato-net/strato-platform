pragma solidity ^0.8.0;

import "./RedemptionService.sol";
import "../Bridge/MercataETHBridge.sol";

contract CryptoRedemptionService is RedemptionService {
    MercataETHBridge public bridge;

    constructor(
        address _token,
        address _usdcToken,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount,
        address _bridge
    ) RedemptionService(
        _token,
        _usdcToken,
        _pool,
        _initialSpotPrice,
        _maxRedemptionAmount,
    ) {
        bridge = MercataETHBridge(_bridge);
    }

    /**
     * @notice Redeem tokens for underlying crypto assets at the spot price
     * @param tokenAmount Amount of tokens to redeem
     * @param baseAddress The address to receive the native tokens
     */
    function redeemAtSpot(uint256 tokenAmount, string memory baseAddress) external override {
        require(redemptionsEnabled, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        // Transfer tokens from user to contract
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");

        // Use bridge to burn and initiate withdrawal
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        bridge.burnETHST(tokens, tokenAmount, baseAddress);
        emit Redeemed(msg.sender, tokenAmount);
    }
} 
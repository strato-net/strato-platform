
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "../Pools/Pool.sol";

/**
 * @title RedemptionContract
 * @dev Allows holders to redeem their tokens for usdcTokens at the redemption price,
 * providing an arbitrage mechanism to help balance the pool
 */
abstract contract RedemptionContract is Ownable, ERC20Burnable {
    // The token that can be redeemed
    IERC20 public token;
    // The usdcToken used for redemptions
    IERC20 public usdcToken;
    // The associated liquidity pool
    Pool public pool;
    // The redemption price in usdcTokens (scaled by 1e18)
    uint256 public spotPrice;
    // Maximum amount that can be redeemed in a single transaction
    uint256 public maxRedemptionAmount;
    // Whether redemptions are currently enabled
    bool public redemptionsEnabled;

    event Redeemed(address redeemer, uint256 tokenAmount);
    event RedemptionPriceUpdated(uint256 newPrice);
    event MaxRedemptionAmountUpdated(uint256 newAmount);
    event RedemptionsToggled(bool enabled);
    event SpotPriceUpdated(uint256 newPrice);

    constructor(
        address _token,
        address _usdcToken,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount
    ) {
        token = ERC20Burnable(_token);
        usdcToken = ERC20Burnable(_usdcToken);
        pool = Pool(_pool);
        spotPrice = _initialSpotPrice;
        maxRedemptionAmount = _maxRedemptionAmount;
        redemptionsEnabled = true;
    }

    /**
     * @notice Updates the redemption price. Only owner can update.
     * @param newPrice New redemption price (scaled by 1e18)
     */
    function updateSpotPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Invalid price");
        spotPrice = newPrice;
        emit SpotPriceUpdated(newPrice);
    }

    /**
     * @notice Updates the maximum redemption amount. Only owner can update.
     * @param newAmount New maximum redemption amount
     */
    function updateMaxRedemptionAmount(uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Invalid amount");
        maxRedemptionAmount = newAmount;
        emit MaxRedemptionAmountUpdated(newAmount);
    }

    /**
     * @notice Toggles whether redemptions are enabled. Only owner can toggle.
     * @param enabled New enabled state
     */
    function setRedemptionsEnabled(bool enabled) external onlyOwner {
        redemptionsEnabled = enabled;
        emit RedemptionsToggled(enabled);
    }

    /**
     * @notice Redeem tokens for physical RWAs at the spot price
     * @param tokenAmount Amount of tokens to redeem
     */
    function redeemAtSpot(uint256 tokenAmount) external {
        require(redemptionsEnabled, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        // Transfer tokens from user to contract
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");

        // Burn tokens
        require(token.burn(tokenAmount), "Token burn failed");

        emit Redeemed(msg.sender, tokenAmount);
    }

    function sellForSpot(uint256 tokenAmount) external {
        require(redemptionsEnabled, "Redemptions disabled");
        require(tokenAmount > 0, "Amount must be > 0");
        require(tokenAmount <= maxRedemptionAmount, "Amount exceeds maximum");

        uint256 usdcAmount = (tokenAmount * spotPrice) / 1e18;

        //Do a fixed price swap
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Token transfer failed");
        require(usdcToken.transfer(msg.sender, usdcAmount), "Stablecoin transfer failed");

        emit Redeemed(msg.sender, tokenAmount, usdcAmount);
    }

    /**
     * @notice Withdraw excess tokens/usdcTokens. Only owner can withdraw.
     * @param tokenAddress Address of token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawTokens(address tokenAddress, uint256 amount) external onlyOwner {
        IERC20 tokenToWithdraw = IERC20(tokenAddress);
        require(tokenToWithdraw.transfer(owner(), amount), "Transfer failed");
    }

    /**
     * @notice Get current pool price for comparison
     * @return Current pool price scaled by 1e18
     */
    function getPoolPrice() public view returns (uint256) {
        return uint256(pool.getCurrentTokenPrice() * 1e18);
    }

    /**
     * @notice Check if arbitrage opportunity exists
     * @return bool Whether arbitrage is possible
     * @return uint256 Price difference (absolute value, scaled by 1e18)
     */
    function checkArbitrage() external view returns (bool, uint256) {
        uint256 poolPrice = getPoolPrice();
        if (poolPrice > spotPrice) {
            return (true, poolPrice - spotPrice);
        } else if (spotPrice > poolPrice) {
            return (true, spotPrice - poolPrice);
        }
        return (false, 0);
    }
} 
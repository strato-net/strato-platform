import "../Pools/Pool.sol";
// import "../Bridge/MercataETHBridge.sol";

import "../ERC20/ERC20.sol";
import "../ERC20/extensions/ERC20Burnable.sol";
import "../ERC20/access/Ownable.sol";

/**
 * @title RedemptionContract
 * @dev Allows holders to redeem their tokens for usdcTokens at the redemption price,
 * providing an arbitrage mechanism to help balance the pool
 */
abstract contract RedemptionService is Ownable, ERC20Burnable {
    // The token that can be redeemed
    ERC20Burnable public token;

    bool public isActive;

    // The associated liquidity pool
    Pool public pool;
    // The redemption price in usdcTokens (scaled by 1e18)
    uint256 public spotPrice;
    // Maximum amount that can be redeemed in a single transaction
    uint256 public maxRedemptionAmount;

    event Redeemed(address redeemer, uint256 tokenAmount);
    event RedemptionPriceUpdated(uint256 newPrice);
    event MaxRedemptionAmountUpdated(uint256 newAmount);
    event SpotPriceUpdated(uint256 newPrice);

    constructor(
        address _token,
        address _pool,
        uint256 _initialSpotPrice,
        uint256 _maxRedemptionAmount
    ) {
        token = ERC20Burnable(_token);
        pool = Pool(_pool);
        spotPrice = _initialSpotPrice;
        maxRedemptionAmount = _maxRedemptionAmount;
    }

    modifier requireActive(string action) {
        string err = "The redemption service must be active to "
                   + action
                   + ".";
        require(isActive, err);
        _;
    }


    function deactivate() onlyOwner external {
        isActive = false;
    }

    function activate() onlyOwner external {
        isActive = true;
    }

    /**
     * @notice Updates the redemption price. Only owner can update.
     * @param newPrice New redemption price (scaled by 1e18)
     */
    function updateSpotPrice(uint256 newPrice) external onlyOwner requireActive("update the redemption price") {
        require(newPrice > 0, "Invalid price");
        spotPrice = newPrice;
        emit SpotPriceUpdated(newPrice);
    }

    /**
     * @notice Updates the maximum redemption amount. Only owner can update.
     * @param newAmount New maximum redemption amount
     */
    function updateMaxRedemptionAmount(uint256 newAmount) external onlyOwner requireActive("update the maximum redemption amount") {
        require(newAmount > 0, "Invalid amount");
        maxRedemptionAmount = newAmount;
        emit MaxRedemptionAmountUpdated(newAmount);
    }

    /**
     * @notice Redeem tokens for underlying assets at the spot price
     * @param tokenAmount Amount of tokens to redeem
     * @param baseAddress For crypto assets, the address to receive the native tokens
     */
    function redeemAtSpot(uint256 tokenAmount, string memory baseAddress) external virtual;

    /**
     * @notice Withdraw excess tokens/usdcTokens. Only owner can withdraw.
     * @param tokenAddress Address of token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawTokens(address tokenAddress, uint256 amount) external onlyOwner {
        ERC20 tokenToWithdraw = ERC20(tokenAddress);
        require(tokenToWithdraw.transfer(owner(), amount), "Transfer failed");
    }

    /**
     * @notice Get current pool price for comparison
     * @return Current pool price scaled by 1e18
     */
    function getPoolPrice() public view returns (uint) {
        return uint(pool.getCurrentTokenAPrice() * 1e18);
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
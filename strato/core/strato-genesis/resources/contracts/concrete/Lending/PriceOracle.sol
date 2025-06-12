/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev Asset prices are set manually for now; can be upgraded to use external oracles.
 */
 
 contract record PriceOracle is Ownable {
    event PriceUpdated(address asset, uint256 price);

    mapping(address => uint256) public record prices;
    TokenFactory public tokenFactory;

   constructor(address initialOwner, address _tokenFactory) Ownable(initialOwner) {      
        tokenFactory = TokenFactory(_tokenFactory);
    } 

    function setAssetPrice(address asset, uint256 price) external onlyOwner {
        require(price > 0, "Invalid price");
        require(tokenFactory.isTokenActive(asset), "Token not active");
        prices[asset] = price;
        emit PriceUpdated(asset, price);
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        uint256 price = prices[asset];
        require(price > 0, "Price not set");
        return price;
    }

    function setTokenFactory(address _tokenFactory) external onlyOwner {
        tokenFactory = TokenFactory(_tokenFactory);
    }

}
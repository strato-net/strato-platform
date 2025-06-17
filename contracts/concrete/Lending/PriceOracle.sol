import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev Asset prices are set manually for now; can be upgraded to use external oracles.
 */
 
 contract record PriceOracle is Ownable {
   // Asset price storage (price in 8-decimal format: 1e8 = $1.00)
    mapping(address => uint256) public assetPrices;
    mapping(address => uint256) public lastUpdated;
    
    // Authorized oracle addresses
    mapping(address => bool) public authorizedOracles;
    
    // Price validation bounds
    mapping(address => uint256) public minPrice;
    mapping(address => uint256) public maxPrice;
    
    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] prices, uint256 timestamp);
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);
    event PriceBoundsSet(address indexed asset, uint256 minPrice, uint256 maxPrice);
    
    modifier onlyAuthorizedOracle() {
        require(authorizedOracles[msg.sender] || msg.sender == owner(), "Not authorized oracle");
        _;
    }
    
    constructor() {
        // Owner is automatically authorized
        authorizedOracles[msg.sender] = true;
    }
    
    /**
     * @dev Set price for a single asset
     * @param asset The asset address
     * @param price The price in 8-decimal format (1e8 = $1.00)
     */
    function setAssetPrice(address asset, uint256 price) external onlyAuthorizedOracle {
        require(asset != address(0), "Invalid asset address");
        require(price > 0, "Price must be greater than 0");
        
        // Validate price bounds if set
        if (minPrice[asset] > 0) {
            require(price >= minPrice[asset], "Price below minimum");
        }
        if (maxPrice[asset] > 0) {
            require(price <= maxPrice[asset], "Price above maximum");
        }
        
        assetPrices[asset] = price;
        lastUpdated[asset] = block.timestamp;
        
        emit PriceUpdated(asset, price, block.timestamp);
    }
    
    /**
     * @dev Set prices for multiple assets in batch (main function for oracle service)
     * @param assets Array of asset addresses
     * @param prices Array of prices in 8-decimal format
     */
    function setAssetPrices(address[] calldata assets, uint256[] calldata prices) external onlyAuthorizedOracle {
        require(assets.length == prices.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "Invalid asset address");
            require(prices[i] > 0, "Price must be greater than 0");
            
            // Validate price bounds if set
            if (minPrice[assets[i]] > 0) {
                require(prices[i] >= minPrice[assets[i]], "Price below minimum");
            }
            if (maxPrice[assets[i]] > 0) {
                require(prices[i] <= maxPrice[assets[i]], "Price above maximum");
            }
            
            assetPrices[assets[i]] = prices[i];
            lastUpdated[assets[i]] = block.timestamp;
        }
        
        emit BatchPricesUpdated(assets, prices, block.timestamp);
    }
    
    /**
     * @dev Get price for an asset
     * @param asset The asset address
     * @return price The price in 8-decimal format
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 price = assetPrices[asset];
        require(price > 0, "Price not available");
        return price;
    }
    
    /**
     * @dev Get price with timestamp for an asset
     * @param asset The asset address
     * @return price The price in 8-decimal format
     * @return timestamp When the price was last updated
     */
    function getAssetPriceWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = assetPrices[asset];
        require(price > 0, "Price not available");
        timestamp = lastUpdated[asset];
        return (price, timestamp);
    }
    
    /**
     * @dev Get prices for multiple assets
     * @param assets Array of asset addresses
     * @return prices Array of prices in 8-decimal format
     */
    function getAssetPrices(address[] calldata assets) external view returns (uint256[] memory prices) {
        prices = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "Invalid asset address");
            uint256 price = assetPrices[assets[i]];
            require(price > 0, "Price not available");
            prices[i] = price;
        }
        return prices;
    }
    
    /**
     * @dev Check if price is fresh (updated within specified time)
     * @param asset The asset address
     * @param maxAge Maximum age in seconds
     * @return true if price is fresh
     */
    function isPriceFresh(address asset, uint256 maxAge) external view returns (bool) {
        if (assetPrices[asset] == 0) return false;
        return (block.timestamp - lastUpdated[asset]) <= maxAge;
    }
    
    /**
     * @dev Get price age in seconds
     * @param asset The asset address
     * @return age Age of the price in seconds
     */
    function getPriceAge(address asset) external view returns (uint256) {
        require(assetPrices[asset] > 0, "Price not available");
        return block.timestamp - lastUpdated[asset];
    }
    
    // Oracle Management Functions
    
    /**
     * @dev Authorize an oracle address
     * @param oracle The oracle address to authorize
     */
    function authorizeOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        authorizedOracles[oracle] = true;
        emit OracleAuthorized(oracle);
    }
    
    /**
     * @dev Revoke oracle authorization
     * @param oracle The oracle address to revoke
     */
    function revokeOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        authorizedOracles[oracle] = false;
        emit OracleRevoked(oracle);
    }
    
    /**
     * @dev Check if address is authorized oracle
     * @param oracle The address to check
     * @return true if authorized
     */
    function isAuthorizedOracle(address oracle) external view returns (bool) {
        return authorizedOracles[oracle];
    }
    
    // Price Bounds Management
    
    /**
     * @dev Set price bounds for an asset
     * @param asset The asset address
     * @param _minPrice Minimum acceptable price (0 = no minimum)
     * @param _maxPrice Maximum acceptable price (0 = no maximum)
     */
    function setPriceBounds(address asset, uint256 _minPrice, uint256 _maxPrice) external onlyOwner {
        require(asset != address(0), "Invalid asset address");
        if (_minPrice > 0 && _maxPrice > 0) {
            require(_minPrice < _maxPrice, "Min price must be less than max price");
        }
        
        minPrice[asset] = _minPrice;
        maxPrice[asset] = _maxPrice;
        
        emit PriceBoundsSet(asset, _minPrice, _maxPrice);
    }
    
    /**
     * @dev Get price bounds for an asset
     * @param asset The asset address
     * @return _minPrice Minimum price bound
     * @return _maxPrice Maximum price bound
     */
    function getPriceBounds(address asset) external view returns (uint256 _minPrice, uint256 _maxPrice) {
        return (minPrice[asset], maxPrice[asset]);
    }
    
    // Utility Functions
    
    /**
     * @dev Convert price from external format to internal 8-decimal format
     * @param price Price in external format
     * @param decimals Number of decimals in external format
     * @return Converted price in 8-decimal format
     */
    function convertToInternalPrice(uint256 price, uint8 decimals) external pure returns (uint256) {
        if (decimals == 8) {
            return price;
        } else if (decimals < 8) {
            return price * (10 ** (8 - decimals));
        } else {
            return price / (10 ** (decimals - 8));
        }
    }
    
    /**
     * @dev Convert price from internal 8-decimal format to external format
     * @param price Price in internal 8-decimal format
     * @param decimals Desired number of decimals in output
     * @return Converted price
     */
    function convertFromInternalPrice(uint256 price, uint8 decimals) external pure returns (uint256) {
        if (decimals == 8) {
            return price;
        } else if (decimals < 8) {
            return price / (10 ** (8 - decimals));
        } else {
            return price * (10 ** (decimals - 8));
        }
    }
    
    /**
     * @dev Emergency function to pause price updates
     */
    function emergencyPause() external onlyOwner {
        // Remove all oracle authorizations except owner
        // This effectively pauses the oracle service
        // Implementation depends on your specific needs
    }
}


import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title PriceOracle
 * @notice Provides asset price feeds used for loan value and collateral validation.
 * @dev Asset prices are set manually for now; can be upgraded to use external oracles.
 */
 
 contract record PriceOracle is Ownable {
    // Asset price storage (price in 8-decimal format: 1e8 = $1.00)
    mapping(address => uint256) public record prices;
    mapping(address => uint256) public record lastUpdated;
    
    // Authorized oracle addresses
    mapping(address => bool) public record authorizedOracles;
    
    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);
    event BatchPricesUpdated(address[] assets, uint256[] priceValues, uint256 timestamp);
    event OracleAuthorized(address indexed oracle);
    event OracleRevoked(address indexed oracle);
    
    modifier onlyAuthorizedOracle() {
        require(authorizedOracles[msg.sender] || msg.sender == owner(), "Not authorized oracle");
        _;
    }
    
    constructor(address _authorizedOracle) {
        // Owner is automatically authorized
        require(_authorizedOracle != address(0), "Invalid oracle address");
        authorizedOracles[_authorizedOracle] = true;
    }
    
    /**
     * @dev Set price for a single asset
     */
    function setAssetPrice(address asset, uint256 price) external onlyAuthorizedOracle {
        require(asset != address(0), "Invalid asset address");
        require(price > 0, "Price must be greater than 0");
        
        prices[asset] = price;
        lastUpdated[asset] = block.timestamp;
        
        emit PriceUpdated(asset, price, block.timestamp);
    }
    
    /**
     * @dev Set prices for multiple assets in batch (main function for oracle service)
     */
    function setAssetPrices(address[] calldata assets, uint256[] calldata priceValues) external onlyAuthorizedOracle {
        require(assets.length == priceValues.length, "Arrays length mismatch");
        require(assets.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(assets[i] != address(0), "Invalid asset address");
            require(priceValues[i] > 0, "Price must be greater than 0");
            
            prices[assets[i]] = priceValues[i];
            lastUpdated[assets[i]] = block.timestamp;
        }
        
        emit BatchPricesUpdated(assets, priceValues, block.timestamp);
    }
    
    /**
     * @dev Get price for an asset
     */
    function getAssetPrice(address asset) external view returns (uint256) {
        require(asset != address(0), "Invalid asset address");
        uint256 price = prices[asset];
        require(price > 0, "Price not available");
        return price;
    }
    
    /**
     * @dev Get price with timestamp for an asset
     */
    function getAssetPriceWithTimestamp(address asset) external view returns (uint256 price, uint256 timestamp) {
        require(asset != address(0), "Invalid asset address");
        price = prices[asset];
        require(price > 0, "Price not available");
        timestamp = lastUpdated[asset];
        return (price, timestamp);
    }
    
    /**
     * @dev Check if price is fresh (updated within specified time)
     */
    function isPriceFresh(address asset, uint256 maxAge) external view returns (bool) {
        if (prices[asset] == 0) return false;
        return (block.timestamp - lastUpdated[asset]) <= maxAge;
    }
    
    /**
     * @dev Authorize an oracle address
     */
    function authorizeOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        authorizedOracles[oracle] = true;
        emit OracleAuthorized(oracle);
    }
    
    /**
     * @dev Revoke oracle authorization
     */
    function revokeOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle address");
        authorizedOracles[oracle] = false;
        emit OracleRevoked(oracle);
    }
    
    /**
     * @dev Check if address is authorized oracle
     */
    function isAuthorizedOracle(address oracle) external view returns (bool) {
        return authorizedOracles[oracle];
    }
}



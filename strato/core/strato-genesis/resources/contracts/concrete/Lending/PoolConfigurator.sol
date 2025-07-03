import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title PoolConfigurator
 * @notice Governance contract responsible for updating addresses in the LendingRegistry
 *         and configuring LendingPool risk parameters.
 * @dev Meant to be controlled by a multisig, DAO, or timelock for secure protocol configuration.
 */

contract record PoolConfigurator is Ownable {
   
    LendingRegistry public immutable registry;

    event AssetConfigured(address indexed asset, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 interestRate);

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        registry = LendingRegistry(_registry);
    }

    /**
     * @notice Initialize entire protocol in a single transaction (deployment helper)
     * @param lendingPool LendingPool address
     * @param liquidityPool LiquidityPool address
     * @param collateralVault CollateralVault address
     * @param rateStrategy RateStrategy address
     * @param priceOracle PriceOracle address
     * @param tokenFactory TokenFactory address
     * @param assets Array of initial assets to configure
     * @param ltvs Array of LTV ratios for assets
     * @param liquidationThresholds Array of liquidation thresholds for assets
     * @param liquidationBonuses Array of liquidation bonuses for assets
     * @param interestRates Array of interest rates for assets
     * @param reserveFactors Array of reserve factors for assets
     */

    function initializeProtocol(
        address lendingPool,
        address liquidityPool,
        address collateralVault,
        address rateStrategy,
        address priceOracle,
        address tokenFactory,
        address[] calldata assets,
        uint256[] calldata ltvs,
        uint256[] calldata liquidationThresholds,
        uint256[] calldata liquidationBonuses,
        uint256[] calldata interestRates,
        uint256[] calldata reserveFactors
    ) external onlyOwner {
        // Set all registry components
        registry.setAllComponents(lendingPool, liquidityPool, collateralVault, rateStrategy, priceOracle);
        
        // Set token factory
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.setTokenFactory(tokenFactory);
        
        // Configure all assets if provided
        if (assets.length > 0) {
            // Validate array lengths match
            require(ltvs.length == assets.length, "LTVs length mismatch");
            require(liquidationThresholds.length == assets.length, "Liquidation thresholds length mismatch");
            require(liquidationBonuses.length == assets.length, "Liquidation bonuses length mismatch");
            require(interestRates.length == assets.length, "Interest rates length mismatch");
            require(reserveFactors.length == assets.length, "Reserve factors length mismatch");
            
            for (uint256 i = 0; i < assets.length; i++) {
                lendingPool.configureAsset(
                    assets[i], 
                    ltvs[i], 
                    liquidationThresholds[i], 
                    liquidationBonuses[i], 
                    interestRates[i],
                    reserveFactors[i]
                );
                emit AssetConfigured(assets[i], ltvs[i], liquidationThresholds[i], liquidationBonuses[i], interestRates[i]);
            }
        }
    }

    /**
     * @notice Configure multiple assets in a single transaction
     * @param assets Array of asset addresses
     * @param ltvs Array of LTV ratios in basis points
     * @param liquidationThresholds Array of liquidation thresholds in basis points
     * @param liquidationBonuses Array of liquidation bonuses in basis points
     * @param interestRates Array of interest rates in basis points
     * @param reserveFactors Array of reserve factors in basis points
     */
    function configureAssets(
        address[] calldata assets,
        uint256[] calldata ltvs,
        uint256[] calldata liquidationThresholds,
        uint256[] calldata liquidationBonuses,
        uint256[] calldata interestRates,
        uint256[] calldata reserveFactors
    ) external onlyOwner {
        // Validate array lengths match
        require(assets.length > 0, "No assets provided");
        require(ltvs.length == assets.length, "LTVs length mismatch");
        require(liquidationThresholds.length == assets.length, "Liquidation thresholds length mismatch");
        require(liquidationBonuses.length == assets.length, "Liquidation bonuses length mismatch");
        require(interestRates.length == assets.length, "Interest rates length mismatch");
        require(reserveFactors.length == assets.length, "Reserve factors length mismatch");
        
        for (uint256 i = 0; i < assets.length; i++) {
            LendingPool lendingPool = LendingPool(registry.getLendingPool());
            lendingPool.configureAsset(
                assets[i], 
                ltvs[i], 
                liquidationThresholds[i], 
                liquidationBonuses[i], 
                interestRates[i],
                reserveFactors[i]
            );
            emit AssetConfigured(assets[i], ltvs[i], liquidationThresholds[i], liquidationBonuses[i], interestRates[i]);
        }
    }

    /**
     * @notice Configure single asset parameters
     * @param asset The asset address
     * @param ltv Loan-to-Value ratio in basis points (e.g., 7500 = 75%)
     * @param liquidationThreshold Liquidation threshold in basis points (e.g., 8000 = 80%)
     * @param liquidationBonus Liquidation bonus in basis points (e.g., 10500 = 105%)
     * @param interestRate Interest rate in basis points (e.g., 500 = 5%)
     * @param reserveFactor Reserve factor in basis points (e.g., 1000 = 10%)
     */
    function configureAsset(
        address asset,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 liquidationBonus,
        uint256 interestRate,
        uint256 reserveFactor
    ) external onlyOwner {
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.configureAsset(asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor);
        emit AssetConfigured(asset, ltv, liquidationThreshold, liquidationBonus, interestRate);
    }

    /**
     * @notice Get asset configuration
     * @param asset The asset address
     * @return ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor
     */
    function getAssetConfig(address asset) external view returns (uint256, uint256, uint256, uint256, uint256) {
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        return lendingPool.getAssetConfig(asset);
    }

    /**
     * @notice Set token factory address
     * @param _tokenFactory The token factory address
     */
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.setTokenFactory(_tokenFactory);
    }

    /**
     * @notice Set fee collector address
     * @param _feeCollector The fee collector address
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.setFeeCollector(_feeCollector);
    }

     // Setter function for borrowable asset
    function setBorrowableAsset(address asset) external onlyOwner {
        require(asset != address(0), "Invalid asset address");
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.setBorrowableAsset(asset);
    }

    // Setter function for mToken
    function setMToken(address mToken) external onlyOwner {
        require(mToken != address(0), "Invalid mToken address");
        LendingPool lendingPool = LendingPool(registry.getLendingPool());
        lendingPool.setMToken(mToken);
    }
    
} 
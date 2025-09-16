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

    event AssetConfigured(address indexed asset, uint ltv, uint liquidationThreshold, uint liquidationBonus, uint interestRate, uint reserveFactor, uint perSecondFactorRAY);

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
     * @param perSecondFactorsRAY Array of per-second compound factors in RAY (1e27)
     */

    function initializeProtocol(
        address lendingPool,
        address liquidityPool,
        address collateralVault,
        address rateStrategy,
        address priceOracle,
        address tokenFactory,
        address[] calldata assets,
        uint[] calldata ltvs,
        uint[] calldata liquidationThresholds,
        uint[] calldata liquidationBonuses,
        uint[] calldata interestRates,
        uint[] calldata reserveFactors,
        uint[] calldata perSecondFactorsRAY,
        uint debtCeilingAssetUnits,
        uint debtCeilingUSD,
        uint safetyShareBps
    ) external onlyOwner {
        // Set all registry components
        registry.setAllComponents(lendingPool, liquidityPool, collateralVault, rateStrategy, priceOracle);
        
        // Set token factory
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setTokenFactory(tokenFactory);

        // Set initial debt ceilings and safety share
        pool.setDebtCeilings(debtCeilingAssetUnits, debtCeilingUSD);
        pool.setSafetyShareBps(safetyShareBps);
        
        // Configure all assets if provided
        if (assets.length > 0) {
            // Validate array lengths match
            require(ltvs.length == assets.length, "LTVs length mismatch");
            require(liquidationThresholds.length == assets.length, "Liquidation thresholds length mismatch");
            require(liquidationBonuses.length == assets.length, "Liquidation bonuses length mismatch");
            require(interestRates.length == assets.length, "Interest rates length mismatch");
            require(reserveFactors.length == assets.length, "Reserve factors length mismatch");
            require(perSecondFactorsRAY.length == assets.length, "per-second factors length mismatch");
            
            for (uint i = 0; i < assets.length; i++) {
                pool.configureAsset(
                    assets[i], 
                    ltvs[i], 
                    liquidationThresholds[i], 
                    liquidationBonuses[i], 
                    interestRates[i],
                    reserveFactors[i],
                    perSecondFactorsRAY[i]
                );
                emit AssetConfigured(assets[i], ltvs[i], liquidationThresholds[i], liquidationBonuses[i], interestRates[i],reserveFactors[i],perSecondFactorsRAY[i]) ;
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
     * @param perSecondFactorsRAY Array of per-second compound factors in RAY (1e27)
     */
    function configureAssets(
        address[] calldata assets,
        uint[] calldata ltvs,
        uint[] calldata liquidationThresholds,
        uint[] calldata liquidationBonuses,
        uint[] calldata interestRates,
        uint[] calldata reserveFactors,
        uint[] calldata perSecondFactorsRAY
    ) external onlyOwner {
        // Validate array lengths match
        require(assets.length > 0, "No assets provided");
        require(ltvs.length == assets.length, "LTVs length mismatch");
        require(liquidationThresholds.length == assets.length, "Liquidation thresholds length mismatch");
        require(liquidationBonuses.length == assets.length, "Liquidation bonuses length mismatch");
        require(interestRates.length == assets.length, "Interest rates length mismatch");
        require(reserveFactors.length == assets.length, "Reserve factors length mismatch");
        require(perSecondFactorsRAY.length == assets.length, "per-second factors length mismatch");
        
        for (uint i = 0; i < assets.length; i++) {
            LendingPool pool = LendingPool(registry.getLendingPool());
            pool.configureAsset(
                assets[i], 
                ltvs[i], 
                liquidationThresholds[i], 
                liquidationBonuses[i], 
                interestRates[i],
                reserveFactors[i],
                perSecondFactorsRAY[i]
            );
            emit AssetConfigured(assets[i], ltvs[i], liquidationThresholds[i], liquidationBonuses[i], interestRates[i], reserveFactors[i], perSecondFactorsRAY[i]);
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
     * @param perSecondFactorRAY Per-second compound factor in RAY (1e27)
     */
    function configureAsset(
        address asset,
        uint ltv,
        uint liquidationThreshold,
        uint liquidationBonus,
        uint interestRate,
        uint reserveFactor,
        uint perSecondFactorRAY
    ) external onlyOwner {
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.configureAsset(asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor, perSecondFactorRAY);
        emit AssetConfigured(asset, ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor, perSecondFactorRAY);
    }

    /**
     * @notice Get asset configuration
     * @param asset The asset address
     * @return ltv, liquidationThreshold, liquidationBonus, interestRate, reserveFactor
     */
    function getAssetConfig(address asset) external view returns (uint, uint, uint, uint, uint, uint) {
        LendingPool pool = LendingPool(registry.getLendingPool());
        return pool.getAssetConfig(asset);
    }

    /**
     * @notice Set token factory address
     * @param _tokenFactory The token factory address
     */
    function setTokenFactory(address _tokenFactory) external onlyOwner {
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setTokenFactory(_tokenFactory);
    }

    /**
     * @notice Set fee collector address
     * @param _feeCollector The fee collector address
     */
    function setFeeCollector(address _feeCollector) external onlyOwner {
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setFeeCollector(_feeCollector);
    }

     // Setter function for borrowable asset
    function setBorrowableAsset(address asset) external onlyOwner {
        require(asset != address(0), "Invalid asset address");
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setBorrowableAsset(asset);
    }

    // Setter function for mToken
    function setMToken(address mToken) external onlyOwner {
        require(mToken != address(0), "Invalid mToken address");
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setMToken(mToken);
    }

    /// @notice Governance setter to update debt ceilings later
    function setDebtCeilings(uint assetUnits, uint usdValue) external onlyOwner {
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.setDebtCeilings(assetUnits, usdValue);
    }

    /**
     * @notice Forwarder to sweep protocol reserves from the LendingPool to the FeeCollector
     * @dev Restricted to governance (onlyOwner). The LendingPool enforces bounds and accrual.
     */
    function sweepReserves(uint amount) external onlyOwner {
        LendingPool pool = LendingPool(registry.getLendingPool());
        pool.sweepReserves(amount);
    }
} 
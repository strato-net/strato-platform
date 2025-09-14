import "../../abstract/ERC20/access/Ownable.sol";
import "./LendingPool.sol";
import "./LiquidityPool.sol";
import "./CollateralVault.sol";
import "./RateStrategy.sol";
import "./PriceOracle.sol";
import "./SafetyModule.sol";

/**
 * @title LendingRegistry
 * @notice Central registry contract storing addresses of core lending protocol components.
 * @dev Can only be updated by the PoolConfigurator contract via access control or ownership.
 */
 
contract record LendingRegistry is Ownable {
    // All components at top level - no grouping needed
    LendingPool public lendingPool;
    LiquidityPool public liquidityPool;
    CollateralVault public collateralVault;
    RateStrategy public rateStrategy;
    PriceOracle public priceOracle;
    SafetyModule public safetyModule;

    event ComponentsUpdated(
        address indexed lendingPool,
        address indexed liquidityPool, 
        address indexed collateralVault,
        address rateStrategy,
        address priceOracle,
        address safetyModule
    );

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Set all components in a single transaction (most gas efficient)
     * @param _lendingPool LendingPool address
     * @param _liquidityPool LiquidityPool address
     * @param _collateralVault CollateralVault address
     * @param _rateStrategy RateStrategy address
     * @param _priceOracle PriceOracle address
     * @param _safetyModule SafetyModule address
     */
    function setAllComponents(
        address _lendingPool,
        address _liquidityPool,
        address _collateralVault,
        address _rateStrategy,
        address _priceOracle,
        address _safetyModule
    ) external onlyOwner {
        // Validate addresses individually
        require(_lendingPool != address(0), "Invalid lendingPool address");
        require(_liquidityPool != address(0), "Invalid liquidityPool address");
        require(_collateralVault != address(0), "Invalid collateralVault address");
        require(_rateStrategy != address(0), "Invalid rateStrategy address");
        require(_priceOracle != address(0), "Invalid priceOracle address");
        require(_safetyModule != address(0), "Invalid safetyModule address");
        
        lendingPool = LendingPool(_lendingPool);
        liquidityPool = LiquidityPool(_liquidityPool);
        collateralVault = CollateralVault(_collateralVault);
        rateStrategy = RateStrategy(_rateStrategy);
        priceOracle = PriceOracle(_priceOracle);
        safetyModule = SafetyModule(_safetyModule);

        emit ComponentsUpdated(_lendingPool, _liquidityPool, _collateralVault, _rateStrategy, _priceOracle, _safetyModule);
    }

    /**
     * @notice Set individual component addresses
     */
    function setLendingPool(address _lendingPool) external onlyOwner {
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = LendingPool(_lendingPool);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    function setLiquidityPool(address _liquidityPool) external onlyOwner {
        require(_liquidityPool != address(0), "Invalid address");
        liquidityPool = LiquidityPool(_liquidityPool);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    function setCollateralVault(address _collateralVault) external onlyOwner {
        require(_collateralVault != address(0), "Invalid address");
        collateralVault = CollateralVault(_collateralVault);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    function setRateStrategy(address _rateStrategy) external onlyOwner {
        require(_rateStrategy != address(0), "Invalid address");
        rateStrategy = RateStrategy(_rateStrategy);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    function setPriceOracle(address _priceOracle) external onlyOwner {
        require(_priceOracle != address(0), "Invalid address");
        priceOracle = PriceOracle(_priceOracle);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    function setSafetyModule(address _safetyModule) external onlyOwner {
        require(_safetyModule != address(0), "Invalid address");
        safetyModule = SafetyModule(_safetyModule);
        emit ComponentsUpdated(address(lendingPool), address(liquidityPool), address(collateralVault), address(rateStrategy), address(priceOracle), address(safetyModule));
    }

    /**
     * @notice Get all component addresses in a single call
     * @return lendingPool, liquidityPool, collateralVault, rateStrategy, priceOracle, safetyModule
     */
    function getAllComponents() external view returns (
        address,
        address,
        address,
        address,
        address,
        address
    ) {
        return (
            address(lendingPool),
            address(liquidityPool),
            address(collateralVault),
            address(rateStrategy),
            address(priceOracle),
            address(safetyModule)
        );
    }

    // Getter functions for core components
    function getLendingPool() external view returns (address) {
        return address(lendingPool);
    }

    function getLiquidityPool() external view returns (address) {
        return address(liquidityPool);
    }

    function getCollateralVault() external view returns (address) {
        return address(collateralVault);
    }

    function getRateStrategy() external view returns (address) {
        return address(rateStrategy);
    }

    function getPriceOracle() external view returns (address) {
        return address(priceOracle);
    }

    function getSafetyModule() external view returns (address) {
        return address(safetyModule);
    }
} 
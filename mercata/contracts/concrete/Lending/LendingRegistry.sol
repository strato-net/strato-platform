import "../../abstract/ERC20/access/Ownable.sol";
import "./LendingPool.sol";
import "./LiquidityPool.sol";
import "./CollateralVault.sol";
import "./RateStrategy.sol";
import "./PriceOracle.sol";

/**
 * @title LendingRegistry
 * @notice Central registry contract storing addresses of core lending protocol components.
 * @dev Can only be updated by the PoolConfigurator contract via access control or ownership.
 */
 
 contract record LendingRegistry is Ownable {
    LendingPool public lendingPool;
    LiquidityPool public liquidityPool;
    CollateralVault public collateralVault;
    RateStrategy public rateStrategy;
    PriceOracle public priceOracle;

    event LendingPoolSet(address indexed newAddress);
    event LiquidityPoolSet(address indexed newAddress);
    event CollateralVaultSet(address indexed newAddress);
    event RateStrategySet(address indexed newAddress);
    event PriceOracleSet(address indexed newAddress);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // External setter functions, gated by onlyOwner (e.g. PoolConfigurator)

    function setLendingPool(address _lendingPool) public onlyOwner {
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = LendingPool(_lendingPool);
        emit LendingPoolSet(_lendingPool);
    }

    function setLiquidityPool(address _liquidityPool) public onlyOwner {
        require(_liquidityPool != address(0), "Invalid address");
        liquidityPool = LiquidityPool(_liquidityPool);
        emit LiquidityPoolSet(_liquidityPool);
    }

    function setCollateralVault(address _collateralVault) public onlyOwner {
        require(_collateralVault != address(0), "Invalid address");
        collateralVault = CollateralVault(_collateralVault);
        emit CollateralVaultSet(_collateralVault);
    }

    function setRateStrategy(address _rateStrategy) public onlyOwner {
        require(_rateStrategy != address(0), "Invalid address");
        rateStrategy = RateStrategy(_rateStrategy);
        emit RateStrategySet(_rateStrategy);
    }

    function setPriceOracle(address _priceOracle) public onlyOwner {
        require(_priceOracle != address(0), "Invalid address");
        priceOracle = PriceOracle(_priceOracle);
        emit PriceOracleSet(_priceOracle);
    }
}
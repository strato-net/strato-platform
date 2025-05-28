import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title LendingRegistry
 * @notice Central registry contract storing addresses of core lending protocol components.
 * @dev Can only be updated by the PoolConfigurator contract via access control or ownership.
 */
 
 contract record LendingRegistry is Ownable {
    address public lendingPool;
    address public liquidityPool;
    address public collateralVault;
    address public rateStrategy;
    address public priceOracle;

    event LendingPoolSet(address indexed newAddress);
    event LiquidityPoolSet(address indexed newAddress);
    event CollateralVaultSet(address indexed newAddress);
    event RateStrategySet(address indexed newAddress);
    event PriceOracleSet(address indexed newAddress);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // External setter functions, gated by onlyOwner (e.g. PoolConfigurator)

    function setLendingPool(address _lendingPool) public onlyOwner {
        require(_lendingPool != address(0), "Invalid address");
        lendingPool = _lendingPool;
        emit LendingPoolSet(_lendingPool);
    }

    function setLiquidityPool(address _liquidityPool) public onlyOwner {
        require(_liquidityPool != address(0), "Invalid address");
        liquidityPool = _liquidityPool;
        emit LiquidityPoolSet(_liquidityPool);
    }

    function setCollateralVault(address _collateralVault) public onlyOwner {
        require(_collateralVault != address(0), "Invalid address");
        collateralVault = _collateralVault;
        emit CollateralVaultSet(_collateralVault);
    }

    function setRateStrategy(address _rateStrategy) public onlyOwner {
        require(_rateStrategy != address(0), "Invalid address");
        rateStrategy = _rateStrategy;
        emit RateStrategySet(_rateStrategy);
    }

    function setPriceOracle(address _priceOracle) public onlyOwner {
        require(_priceOracle != address(0), "Invalid address");
        priceOracle = _priceOracle;
        emit PriceOracleSet(_priceOracle);
    }
}
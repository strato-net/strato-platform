
pragma solidvm 12.0;

abstract contract LendingRegistryBase  {
    event LendingPoolUpdated(address indexed newAddress);
    event LiquidityPoolUpdated(address indexed newAddress);
    event CollateralVaultUpdated(address indexed newAddress);
    event RateStrategyUpdated(address indexed newAddress);

    address public lendingPool;
    address public liquidityPool;
    address public collateralVault;
    address public rateStrategy;

    constructor(
        address _lendingPool,
        address _liquidityPool,
        address _collateralVault,
        address _rateStrategy
    ) {
        lendingPool = _lendingPool;
        liquidityPool = _liquidityPool;
        collateralVault = _collateralVault;
        rateStrategy = _rateStrategy;

        emit LendingPoolUpdated(_lendingPool);
        emit LiquidityPoolUpdated(_liquidityPool);
        emit CollateralVaultUpdated(_collateralVault);
        emit RateStrategyUpdated(_rateStrategy);
    }

    function updateLendingPool(address _lendingPool) public   {
        lendingPool = _lendingPool;
        emit LendingPoolUpdated(_lendingPool);
    }

    function updateLiquidityPool(address _liquidityPool) public  {
        liquidityPool = _liquidityPool;
        emit LiquidityPoolUpdated(_liquidityPool);
    }

    function updateCollateralVault(address _collateralVault) public  {
        collateralVault = _collateralVault;
        emit CollateralVaultUpdated(_collateralVault);
    }

    function updateRateStrategy(address _rateStrategy) public  {
        rateStrategy = _rateStrategy;
        emit RateStrategyUpdated(_rateStrategy);
    }
}
import "../../abstract/ERC20/access/Ownable.sol";

contract record LendingRegistry is Ownable {
    event LendingPoolUpdated(address indexed newAddress);
    event LiquidityPoolUpdated(address indexed newAddress);
    event CollateralVaultUpdated(address indexed newAddress);
    event RateStrategyUpdated(address indexed newAddress);

    address public lendingPool;
    address public liquidityPool;
    address public collateralVault;
    address public rateStrategy;

    constructor (
        address _lendingPool,
        address _liquidityPool,
        address _collateralVault,
        address _rateStrategy
    ) Ownable() {
        lendingPool = _lendingPool;
        liquidityPool = _liquidityPool;
        collateralVault = _collateralVault;
        rateStrategy = _rateStrategy;

        emit LendingPoolUpdated(_lendingPool);
        emit LiquidityPoolUpdated(_liquidityPool);
        emit CollateralVaultUpdated(_collateralVault);
        emit RateStrategyUpdated(_rateStrategy);
    }

    function updateLendingPool(address _lendingPool) public onlyOwner {
        lendingPool = _lendingPool;
        emit LendingPoolUpdated(_lendingPool);
    }

    function updateLiquidityPool(address _liquidityPool) public onlyOwner {
        liquidityPool = _liquidityPool;
        emit LiquidityPoolUpdated(_liquidityPool);
    }

    function updateCollateralVault(address _collateralVault) public onlyOwner {
        collateralVault = _collateralVault;
        emit CollateralVaultUpdated(_collateralVault);
    }

    function updateRateStrategy(address _rateStrategy) public onlyOwner {
        rateStrategy = _rateStrategy;
        emit RateStrategyUpdated(_rateStrategy);
    }
}
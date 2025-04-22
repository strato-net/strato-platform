
pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract LendingPool is LendingPoolBase {
    constructor(
        address _liquidityPool,
        address _collateralVault,
        address _rateStrategy,
        address _oracle
    ) {
        liquidityPool = LiquidityPoolBase(_liquidityPool);
        collateralVault = CollateralVaultBase(_collateralVault);
        rateStrategy = RateStrategyBase(_rateStrategy);
        oracle = PriceOracleBase(_oracle);
    }
}

pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract LendingRegistry is LendingRegistryBase {
    // No extra logic needed
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

}

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
    ) LendingRegistryBase (
         _lendingPool,
        _liquidityPool,
        _collateralVault,
        _rateStrategy) {}

}
pragma solidvm 12.0;

import "../../abstract/Lending/LendingRegistryBase.sol";

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
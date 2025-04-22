
pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract LendingPool is LendingPoolBase {
 
    constructor(
        address _liquidityPool,
        address _collateralVault,
        address _rateStrategy,
        address _oracle
    ) LendingPoolBase (
        _liquidityPool,
        _collateralVault,
        _rateStrategy,
        _oracle
    ) {
    }
}
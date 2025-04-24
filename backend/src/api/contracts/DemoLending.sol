
pragma es6;
pragma strict;

import <5237e621b327aa06736c701383dfc969a4957376>;

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
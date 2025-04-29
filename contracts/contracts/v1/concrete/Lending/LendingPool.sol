pragma solidvm 12.0;

import "../../abstract/Lending/LendingPoolBase.sol";

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

pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract PoolConfigurator is PoolConfiguratorBase {
    constructor(address _lendingPool) {
        require(_lendingPool != address(0), "Invalid LendingPool address");
        lendingPool = LendingPoolBase(_lendingPool);
     }
}

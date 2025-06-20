pragma solidvm 12.0;

import "../abstract/BaseCodeCollection.sol";

contract Describe_Mercata {
    function beforeAll() {
    }

    function beforeEach() {
    }

    function it_can_deploy_Mercata() {
        Mercata m = new Mercata();
        require(address(m) != address(0), "address is 0");
    }

    function it_checks_that_lending_pool_is_set() {
        Mercata m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
        require(address(m.collateralVault().lendingPool()) != address(0), "CollateralVault's LendingPool address is 0");
        require(address(m.liquidityPool().lendingPool()) != address(0), "LiquidityPool's LendingPool address is 0");
    }
}
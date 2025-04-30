pragma solidvm 12.0;

import "../../abstract/Lending/PoolConfiguratorBase.sol";

contract PoolConfigurator is PoolConfiguratorBase {
     constructor(address _lendingPool) PoolConfiguratorBase(_lendingPool) {
    }
}

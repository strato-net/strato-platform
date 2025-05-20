pragma solidvm 12.0;

import "../../abstract/Lending/LiquidityPoolBase.sol";

contract LiquidityPool is LiquidityPoolBase {
    constructor() LiquidityPoolBase() {
        // lendingPool will be set later via setLendingPool()
    }
}
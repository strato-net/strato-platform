pragma solidvm 12.0;

import "../../abstract/Lending/RateStrategyBase.sol";

contract RateStrategy is RateStrategyBase {
     constructor() {
        // No state to set yet; if `SECONDS_IN_YEAR` is needed from a parent, ensure inheritance
    } 
}
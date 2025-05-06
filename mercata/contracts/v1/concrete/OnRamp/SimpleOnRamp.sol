pragma solidvm 12.0;

import "../../abstract/OnRamp/OnRamp.sol";

contract SimpleOnRamp is OnRamp {
 
    constructor(
        address _oracle,
        address _approver
    ) OnRamp (
        _oracle,
        _approver
    ) {
    }
}
pragma solidvm 12.0;

import "../../abstract/Lending/CollateralVaultBase.sol";

contract CollateralVault is CollateralVaultBase {
    constructor() CollateralVaultBase() {
        // Set lendingPool later
    }
}

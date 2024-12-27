pragma solidvm 11.5;

import "Escrow.sol";

contract SimpleEscrow is Escrow {
    constructor(
        address[] _assets,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio,
        uint _liquidationRatio
    ) Escrow(_assets, _collateralQuantity, _assetPrice, _loanToValueRatio, _liquidationRatio) {
    }
}

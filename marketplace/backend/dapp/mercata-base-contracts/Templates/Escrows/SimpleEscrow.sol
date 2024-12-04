pragma solidvm 11.5;

import <BASE_CODE_COLLECTION>;

contract SimpleEscrow is Escrow {
    constructor(
        address[] _assets,
        uint _collateralQuantity,
        decimal _assetPrice,
        uint _loanToValueRatio
    ) SimpleEscrow(_assets, _collateralQuantity, _assetPrice, _loanToValueRatio) {
    }
}

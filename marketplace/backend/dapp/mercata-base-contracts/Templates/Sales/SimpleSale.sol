pragma es6;
pragma strict;
import <eddd7c9aa884a3b1b8595f0897608c07a8e770b1>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        uint _price,
        uint _quantity,
        address[] _paymentProviders
    ) Sale(_assetToBeSold, _price, _quantity, _paymentProviders) {
    }
}

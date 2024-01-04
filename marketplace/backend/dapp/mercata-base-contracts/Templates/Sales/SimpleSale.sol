pragma es6;
pragma strict;
import <5a4f9eace9d21c1aae3f8e9c21198649b7b9ab63>;

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
